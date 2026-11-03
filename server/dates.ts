/**
 * Date policy (see docs/DECISIONS.md):
 *  - Borrowing dates are calendar days written as YYYY-MM-DD.
 *  - A range [start, end] is inclusive: borrowing Jun 3–5 means three days,
 *    and the item is due back by the end of Jun 5.
 *  - "Today" is the calendar day in the community's time zone
 *    (COMMUNITY_TIME_ZONE, default America/Toronto), so everyone sees the
 *    same day flip regardless of their device's zone.
 *  - Two ranges overlap when a.start <= b.end && b.start <= a.end, so a
 *    hand-back day can't also be the next person's pickup day.
 *  - Timestamps (when something happened) are stored as UTC ISO strings.
 */

export const TIME_ZONE = process.env.COMMUNITY_TIME_ZONE ?? 'America/Toronto';

let nowFn: () => Date = () => new Date();

/** Tests can pin the clock. */
export function setClock(fn: (() => Date) | null) {
  nowFn = fn ?? (() => new Date());
}

/** The current clock function, so callers can restore it. */
export function getClock(): () => Date {
  return nowFn;
}

export function now(): Date {
  return nowFn();
}

export function nowIso(): string {
  return now().toISOString();
}

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function today(): string {
  return dayFormatter.format(now());
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDay(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DAY.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function toUtc(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(day: string, n: number): string {
  const dt = new Date(toUtc(day) + n * 86_400_000);
  return dt.toISOString().slice(0, 10);
}

/** Number of days between two days (b - a). */
export function diffDays(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/** Inclusive length of a range in days. */
export function rangeLength(start: string, end: string): number {
  return diffDays(start, end) + 1;
}

export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}
