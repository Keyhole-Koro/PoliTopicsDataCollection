import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { parseYmdOrNull } from './http';
import { addDays, dateStrJST } from './date';

export type RunRange = { from: string; until: string };

function parseRangeDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function splitRangeByDays(range: RunRange, chunkDays: number): RunRange[] {
  const days = Math.max(1, Math.floor(chunkDays));
  const start = parseRangeDate(range.from);
  const end = parseRangeDate(range.until);
  if (!start || !end || start.getTime() > end.getTime()) {
    return [range];
  }

  const ranges: RunRange[] = [];
  let cursor = start;
  while (cursor.getTime() <= end.getTime()) {
    const segmentEnd = addDays(cursor, days - 1);
    const actualEnd = segmentEnd.getTime() > end.getTime() ? end : segmentEnd;
    ranges.push({
      from: dateStrJST(0, cursor),
      until: dateStrJST(0, actualEnd),
    });
    cursor = addDays(actualEnd, 1);
  }

  return ranges;
}

export function deriveRangeFromHttp(event: APIGatewayProxyEventV2): RunRange | null {
  const method = event.requestContext.http.method;
  if (method === 'POST') {
    const raw = event.body ? (event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body) : '';
    try {
      const body = raw ? JSON.parse(raw) : {};
      const from = parseYmdOrNull(body?.from);
      const until = parseYmdOrNull(body?.until);
      const today = dateStrJST(0);
      return { from: from ?? today, until: until ?? (from ?? today) };
    } catch { return null; }
  }
  const from = parseYmdOrNull(event.queryStringParameters?.from);
  const until = parseYmdOrNull(event.queryStringParameters?.until);
  const today = dateStrJST(0);
  return { from: from ?? today, until: until ?? (from ?? today) };
}

export function deriveRangeFromSqsRecord(rec: any): RunRange | null {
  try {
    const body = JSON.parse(rec?.body || '{}');
    if (body?.type !== 'run') return null;
    const from = parseYmdOrNull(body?.from) || dateStrJST(0);
    const until = parseYmdOrNull(body?.until) || from;
    return { from, until };
  } catch { return null; }
}

export function defaultCronRange(): RunRange {
  const from = dateStrJST(-21);
  const until = dateStrJST(0);
  return { from, until };
}
