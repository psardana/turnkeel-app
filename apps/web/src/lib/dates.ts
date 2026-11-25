import { messages } from '@/messages';

/**
 * Times are stored in UTC and shown in the viewer's time zone, with the year whenever
 * it is not the current one. The words are English, so the formats
 * are fixed: `11 Nov, 14:32` and `11 Nov 2025, 14:32`.
 */
const LOCALE = 'en-GB';

interface Parts {
  year: number;
  month: number;
  day: number;
}

function partsIn(date: Date, timeZone: string | undefined): Parts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0');
  return { year: read('year'), month: read('month'), day: read('day') };
}

const pad = (value: number) => String(value).padStart(2, '0');

/** The calendar day a time falls on for the viewer, as `2026-11-11`. */
export function dayKey(iso: string | Date, timeZone?: string): string {
  const { year, month, day } = partsIn(new Date(iso), timeZone);
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** `14:32`, on the 24-hour clock. */
export function formatTime(iso: string | Date, timeZone?: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

/** `14:32:05`, on the 24-hour clock, where two times in a minute must be told apart. */
export function formatTimeWithSeconds(iso: string | Date, timeZone?: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

/** `11 Nov`, or `11 Nov 2025` when the year is not the current one. */
export function formatDay(iso: string | Date, now: Date = new Date(), timeZone?: string): string {
  const date = new Date(iso);
  const sameYear = partsIn(date, timeZone).year === partsIn(now, timeZone).year;
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date);
}

/** `11 Nov, 14:32`, or `11 Nov 2025, 14:32` when the year is not the current one. */
export function formatDateTime(
  iso: string | Date,
  now: Date = new Date(),
  timeZone?: string,
): string {
  return `${formatDay(iso, now, timeZone)}, ${formatTime(iso, timeZone)}`;
}

/** A day as a heading: Today, Yesterday, or the date. */
export function formatDayHeading(
  iso: string | Date,
  now: Date = new Date(),
  timeZone?: string,
): string {
  const key = dayKey(iso, timeZone);
  if (key === dayKey(now, timeZone)) return messages.dates.today;
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (key === dayKey(yesterday, timeZone)) return messages.dates.yesterday;
  return formatDay(iso, now, timeZone);
}

/**
 * A date that has no time, such as a launch date (`2026-12-01`). It names a calendar
 * day, so no time zone moves it.
 */
export function formatDate(date: string, now: Date = new Date(), timeZone?: string): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const sameYear = year === partsIn(now, timeZone).year;
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const isDateOnly = (value: unknown): value is string =>
  typeof value === 'string' && DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(value));

/**
 * The first or the last moment of a calendar day in the viewer's own time zone, as
 * the UTC timestamp the server takes. The date-range filter of the Activity view
 * holds days; the server compares times.
 */
export function dayBoundary(date: string, edge: 'start' | 'end'): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const local =
    edge === 'start'
      ? new Date(year, month - 1, day, 0, 0, 0, 0)
      : new Date(year, month - 1, day, 23, 59, 59, 999);
  return local.toISOString();
}
