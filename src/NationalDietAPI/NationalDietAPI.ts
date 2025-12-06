import { parse } from 'valibot';

import { rawMeetingDataSchema, type RawMeetingData } from '@NationalDietAPI/Raw';

function normalizePayloadShape(payload: unknown): unknown {
  if (payload && typeof payload === 'object') {
    const nextPayload = { ...(payload as Record<string, unknown>) };
    if (!('meetingRecord' in nextPayload)) {
      nextPayload.meetingRecord = [];
    }
    return nextPayload;
  }
  return payload;
}

export interface FetchParams {
    from?: string;
    until?: string;
    [key: string]: any;
}

async function fetchNationalDietRecords(
  endpoint: string,
  params: FetchParams = {},
): Promise<RawMeetingData> {
  const {
    from = '0000-01-01', // Default start date if not specified
    until = new Date().toISOString().split('T')[0], // Default to today
    ...otherParams
  } = params;

  const queryParams = new URLSearchParams({
    from,
    until,
    recordPacking: 'json',
    ...otherParams,
  });

  const url = `${endpoint}?${queryParams}`;

  console.log(`Fetching records from: ${url}`);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`API request failed: ${response.statusText}`);
    }

    const payload = await response.json();
    const normalizedPayload = normalizePayloadShape(payload);
    const parsed = parse(rawMeetingDataSchema, normalizedPayload);
    return { ...parsed, meetingRecord: parsed.meetingRecord ?? [] };
  } catch (error) {
    console.error('Failed to fetch records:', error);
    throw error;
  }
}

export default fetchNationalDietRecords;
