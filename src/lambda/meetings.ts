import fetchNationalDietRecords from '@NationalDietAPI/NationalDietAPI';
import type { RawMeetingData } from '@NationalDietAPI/Raw';
import type { RunRange } from '@utils/range';

export type MeetingRecord = NonNullable<RawMeetingData['meetingRecord']>[number];

export async function fetchMeetingsForRange(
  endpoint: string,
  range: RunRange,
): Promise<{ meetings: MeetingRecord[]; recordCount: number }> {
  const rawMeetingData: RawMeetingData = await fetchNationalDietRecords(
    endpoint,
    { from: range.from, until: range.until },
  );

  const meetings = rawMeetingData.meetingRecord ?? [];
  const recordCountCandidate = typeof rawMeetingData.numberOfRecords === 'number'
    ? rawMeetingData.numberOfRecords
    : Number(rawMeetingData.numberOfRecords ?? meetings.length);
  const recordCount = Number.isFinite(recordCountCandidate) ? recordCountCandidate : meetings.length;

  return { meetings, recordCount };
}
