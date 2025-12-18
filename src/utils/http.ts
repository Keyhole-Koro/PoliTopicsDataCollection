import type { APIGatewayProxyEventV2, ScheduledEvent } from 'aws-lambda';

export type AnyEvent = APIGatewayProxyEventV2 | ScheduledEvent;

export const isHttpApiEvent = (e: AnyEvent): e is APIGatewayProxyEventV2 =>
  !!(e as APIGatewayProxyEventV2)?.requestContext?.http?.method;

export const lowercaseHeaders = (headers?: Record<string, string | undefined>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v ?? '')]),
  );

export const parseYmdOrNull = (v?: unknown): string | null => {
  if (v == null) return null;
  const s = String(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  if (!Number.isFinite(Date.parse(`${s}T00:00:00Z`))) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : s;
};
