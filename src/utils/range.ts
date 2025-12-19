import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { parseYmdOrNull } from './http';
import { dateStrJST } from './date';

export type RunRange = { from: string; until: string };

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
  const d = dateStrJST(-21);
  return { from: d, until: d };
}

