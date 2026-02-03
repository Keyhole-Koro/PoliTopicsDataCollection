import fetchNationalDietRecords from '@NationalDietAPI/NationalDietAPI';
import type { RawMeetingData } from '@NationalDietAPI/Raw';
import { splitRangeByDays, type RunRange } from '@utils/range';
import { addDays, dateStrJST } from '@utils/date';

export type MeetingRecord = NonNullable<RawMeetingData['meetingRecord']>[number];

export type FetchMeetingsOptions = {
  maxRecords?: number;
  chunkDays?: number;
  intervalMs?: number;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const parseRangeDate = (value: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const daysBetweenInclusive = (from: Date, until: Date): number => {
  const msPerDay = 24 * 60 * 60 * 1000;
  const diff = Math.floor((until.getTime() - from.getTime()) / msPerDay);
  return diff + 1;
};

const splitRangeInHalf = (range: RunRange): RunRange[] | null => {
  const start = parseRangeDate(range.from);
  const end = parseRangeDate(range.until);
  if (!start || !end) return null;
  const days = daysBetweenInclusive(start, end);
  if (days <= 1) return null;
  const leftDays = Math.ceil(days / 2);
  const leftEnd = addDays(start, leftDays - 1);
  const rightStart = addDays(leftEnd, 1);
  return [
    { from: dateStrJST(0, start), until: dateStrJST(0, leftEnd) },
    { from: dateStrJST(0, rightStart), until: dateStrJST(0, end) },
  ];
};

const toNumberOrFallback = (value: unknown, fallback: number): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export async function fetchMeetingsForRange(
  endpoint: string,
  range: RunRange,
  options: FetchMeetingsOptions = {},
): Promise<{ meetings: MeetingRecord[]; recordCount: number }> {
  const chunkDays = Math.max(1, Math.floor(options.chunkDays ?? 7));
  const intervalMs = Math.max(0, Math.floor(options.intervalMs ?? 0));
  const maxRecords = Math.max(1, Math.floor(options.maxRecords ?? 10));
  const ranges = splitRangeByDays(range, chunkDays);

  if (ranges.length > 1) {
    console.log(`[DataCollection] Splitting range into ${ranges.length} segments (chunkDays=${chunkDays})`);
  }

  const meetings: MeetingRecord[] = [];
  let recordCount = 0;
  let requestCount = 0;

  const waitForCooldown = async (splitDepth: number): Promise<void> => {
    if (requestCount === 0 || intervalMs <= 0) {
      requestCount += 1;
      return;
    }
    const factor = Math.max(1, splitDepth + 1);
    const delayMs = intervalMs * factor;
    console.log(`[DataCollection] Waiting ${delayMs}ms before ND API request (splitDepth=${splitDepth})`);
    await sleep(delayMs);
    requestCount += 1;
  };

  const fetchPage = async (segment: RunRange, splitDepth: number, startRecord?: number): Promise<RawMeetingData> => {
    await waitForCooldown(splitDepth);
    return fetchNationalDietRecords(endpoint, {
      from: segment.from,
      until: segment.until,
      maximumRecords: String(maxRecords),
      ...(startRecord ? { startRecord: String(startRecord) } : {}),
    });
  };

  const fetchPaginated = async (
    segment: RunRange,
    splitDepth: number,
    firstResponse: RawMeetingData,
  ): Promise<{ meetings: MeetingRecord[]; recordCount: number }> => {
    const pageMeetings: MeetingRecord[] = [];
    const firstMeetings = firstResponse.meetingRecord ?? [];
    pageMeetings.push(...firstMeetings);
    const total = toNumberOrFallback(firstResponse.numberOfRecords, firstMeetings.length);
    let returned = toNumberOrFallback(firstResponse.numberOfReturn, firstMeetings.length);
    let startRecord = 1 + Math.max(0, returned);
    let page = 1;
    const maxPages = 200;

    while (startRecord <= total && page < maxPages) {
      const response = await fetchPage(segment, splitDepth + 1, startRecord);
      const responseMeetings = response.meetingRecord ?? [];
      pageMeetings.push(...responseMeetings);
      returned = toNumberOrFallback(response.numberOfReturn, responseMeetings.length);
      if (returned <= 0) break;
      startRecord += returned;
      page += 1;
    }

    if (page >= maxPages) {
      console.warn("[DataCollection] Pagination stopped after max pages", {
        range: segment,
        maxPages,
        total,
      });
    }

    return { meetings: pageMeetings, recordCount: total };
  };

  const fetchSegment = async (
    segment: RunRange,
    splitDepth: number,
  ): Promise<{ meetings: MeetingRecord[]; recordCount: number }> => {
    const response = await fetchPage(segment, splitDepth);
    const segmentMeetings = response.meetingRecord ?? [];
    const total = toNumberOrFallback(response.numberOfRecords, segmentMeetings.length);
    const returned = toNumberOrFallback(response.numberOfReturn, segmentMeetings.length);

    if (total > returned) {
      const split = splitRangeInHalf(segment);
      if (split) {
        console.warn("[DataCollection] ND API truncated results; splitting range further", {
          range: segment,
          numberOfRecords: total,
          numberOfReturn: returned,
        });
        const left = await fetchSegment(split[0], splitDepth + 1);
        const right = await fetchSegment(split[1], splitDepth + 1);
        return {
          meetings: [...left.meetings, ...right.meetings],
          recordCount: left.recordCount + right.recordCount,
        };
      }

      console.warn("[DataCollection] ND API truncated results for a single-day range; paging by startRecord", {
        range: segment,
        numberOfRecords: total,
        numberOfReturn: returned,
      });
      return fetchPaginated(segment, splitDepth, response);
    }

    return { meetings: segmentMeetings, recordCount: total };
  };

  for (let i = 0; i < ranges.length; i += 1) {
    const segment = ranges[i];
    const segmentResult = await fetchSegment(segment, 0);
    meetings.push(...segmentResult.meetings);
    recordCount += segmentResult.recordCount;
  }

  return { meetings, recordCount };
}
