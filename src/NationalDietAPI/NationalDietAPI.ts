import { parse } from 'valibot';

import { rawMeetingDataSchema, type RawMeetingData } from '@NationalDietAPI/Raw';
import { readCachedPayload, writeCachedPayload } from './cache';

function normalizeMeetingRecords(value: unknown): unknown[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map(normalizeMeetingRecord);
  }
  return [normalizeMeetingRecord(value)];
}

function normalizeMeetingRecord(record: unknown): unknown {
  if (!record || typeof record !== 'object') {
    return record;
  }
  const next = { ...(record as Record<string, unknown>) };
  next.speechRecord = normalizeSpeechRecords(next.speechRecord);
  return next;
}

function normalizeSpeechRecords(value: unknown): unknown[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map(normalizeSpeechRecord);
  }
  return [normalizeSpeechRecord(value)];
}

function normalizeSpeechRecord(record: unknown): unknown {
  if (!record || typeof record !== 'object') {
    return record;
  }
  const next = { ...(record as Record<string, unknown>) };
  next.createTime = normalizeDateOnly(next.createTime);
  next.updateTime = normalizeDateOnly(next.updateTime);
  return next;
}

function normalizePayloadShape(payload: unknown): unknown {
  if (payload && typeof payload === 'object') {
    const nextPayload = { ...(payload as Record<string, unknown>) };
    nextPayload.meetingRecord = normalizeMeetingRecords(nextPayload.meetingRecord);
    return nextPayload;
  }
  return payload;
}

function normalizeDateOnly(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return typeof value === 'number' ? new Date(value).toISOString().split('T')[0] : undefined;
  }
  const trimmed = value.trim();
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
  if (match) {
    return match[1];
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return trimmed;
  }
  return parsed.toISOString().split('T')[0];
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
    from,
    until,
    ...otherParams
  } = params;

  if (!from || !until) {
    throw new Error('fetchNationalDietRecords requires both "from" and "until" parameters.');
  }

  const queryParams = new URLSearchParams({
    from,
    until,
    recordPacking: 'json',
    ...otherParams,
  });

  const url = `${endpoint}?${queryParams}`;

  console.log(`Fetching records from: ${url}`);

  try {
    let payload: unknown | null = await readCachedPayload(url);
    if (payload == null) {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`API request failed: ${response.statusText}`);
      }
      payload = await response.json();
      await writeCachedPayload(url, payload);
    }

    const normalizedPayload = normalizePayloadShape(payload);
    const parsed = parse(rawMeetingDataSchema, normalizedPayload);
    return { ...parsed, meetingRecord: parsed.meetingRecord ?? [] };
  } catch (error) {
    console.error('Failed to fetch records:', error);
    throw error;
  }
}

export default fetchNationalDietRecords;
