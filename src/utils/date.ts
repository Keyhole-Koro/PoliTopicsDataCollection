const JST_OFFSET_MINUTES = 9 * 60;
const JST_OFFSET_MS = JST_OFFSET_MINUTES * 60 * 1000;

const pad2 = (value: number): string => value.toString().padStart(2, '0');

/**
 * Returns the ISO date (YYYY-MM-DD) for a day in JST.
 *
 * @param offsetDays Number of days to add (negative for past days).
 * @param reference  Date used as a base (defaults to current time).
 */
export function dateStrJST(offsetDays = 0, reference: Date = new Date()): string {
  const jst = new Date(reference.getTime() + JST_OFFSET_MS);
  if (offsetDays !== 0) {
    jst.setUTCDate(jst.getUTCDate() + offsetDays);
  }
  const year = jst.getUTCFullYear();
  const month = jst.getUTCMonth() + 1;
  const day = jst.getUTCDate();
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/**
 * Returns a new Date representing JST midnight for the provided reference day.
 */
export function startOfDayJST(reference: Date = new Date()): Date {
  const local = new Date(reference.getTime() + JST_OFFSET_MS);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  const day = local.getUTCDate();
  const utcMidnight = Date.UTC(year, month, day);
  return new Date(utcMidnight - JST_OFFSET_MS);
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export { JST_OFFSET_MINUTES };
