// Calendar days are plain YYYY-MM-DD strings. We format them as UTC so a
// viewer's own time zone can never shift a date by one.

const dayFmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts });
const short = dayFmt({ month: 'short', day: 'numeric' });
const withWeekday = dayFmt({ weekday: 'short', month: 'short', day: 'numeric' });
const longDay = dayFmt({ weekday: 'long', month: 'long', day: 'numeric' });
const monthYear = dayFmt({ month: 'long', year: 'numeric' });
const monthOnly = dayFmt({ month: 'short' });
const dayNum = dayFmt({ day: 'numeric' });

export function toDate(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function fromDate(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  return fromDate(new Date(toDate(day).getTime() + n * 86_400_000));
}

export function diffDays(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000);
}

export const formatDay = (day: string) => short.format(toDate(day));
export const formatDayWeekday = (day: string) => withWeekday.format(toDate(day));
export const formatDayLong = (day: string) => longDay.format(toDate(day));
export const formatMonthYear = (day: string) => monthYear.format(toDate(day));

export function formatRange(start: string, end: string): string {
  if (start === end) return formatDay(start);
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  if (sameMonth) return `${monthOnly.format(toDate(start))} ${dayNum.format(toDate(start))} – ${dayNum.format(toDate(end))}`;
  return `${formatDay(start)} – ${formatDay(end)}`;
}

export function nights(start: string, end: string) {
  const n = diffDays(start, end) + 1;
  return `${n} day${n === 1 ? '' : 's'}`;
}

export function relativeDay(day: string, today: string): string {
  const n = diffDays(today, day);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  if (n > 1 && n < 7) return `in ${n} days`;
  if (n < -1 && n > -7) return `${-n} days ago`;
  return `on ${formatDayWeekday(day)}`;
}

export function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

let communityTz = 'America/Toronto';
export function setTimeZone(tz: string) {
  communityTz = tz;
}

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${plural(hours, 'hour')} ago`;
  return formatMoment(iso);
}

export function formatMoment(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: communityTz,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function greeting(): string {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: communityTz, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  if (hour < 5) return 'Hello';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function memberSince(iso: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: communityTz }).format(new Date(iso));
}

export function monthGrid(firstOfMonth: string): (string | null)[] {
  const first = toDate(firstOfMonth);
  const lead = first.getUTCDay(); // Sunday-first weeks
  const daysInMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let i = 0; i < daysInMonth; i++) cells.push(addDays(firstOfMonth, i));
  while (cells.length % 7) cells.push(null);
  return cells;
}

export function startOfMonth(day: string) {
  return `${day.slice(0, 7)}-01`;
}

export function addMonths(firstOfMonth: string, n: number) {
  const d = toDate(firstOfMonth);
  return fromDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)));
}
