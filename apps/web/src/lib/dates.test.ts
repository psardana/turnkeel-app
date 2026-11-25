import { describe, expect, it } from 'vitest';
import {
  dayBoundary,
  dayKey,
  formatDate,
  formatDateTime,
  formatDay,
  formatDayHeading,
  formatTime,
  isDateOnly,
} from './dates';

const now = new Date('2026-11-11T12:00:00.000Z');

describe('dates', () => {
  it("shows a time in the viewer's time zone", () => {
    const at = '2026-11-11T09:30:00.000Z';
    expect(formatTime(at, 'UTC')).toBe('09:30');
    expect(formatTime(at, 'Europe/Berlin')).toBe('10:30');
    expect(formatTime(at, 'Asia/Kolkata')).toBe('15:00');
    expect(formatTime('2026-11-11T00:05:00.000Z', 'UTC')).toBe('00:05');
  });

  it('leaves the year out when it is the current one, and shows it otherwise', () => {
    expect(formatDateTime('2026-03-04T09:30:00.000Z', now, 'UTC')).toBe('4 Mar, 09:30');
    expect(formatDateTime('2025-03-04T09:30:00.000Z', now, 'UTC')).toBe('4 Mar 2025, 09:30');
    expect(formatDay('2027-01-02T00:00:00.000Z', now, 'UTC')).toBe('2 Jan 2027');
  });

  it("decides the year in the viewer's time zone too", () => {
    // 31 December 2025, 23:30 in UTC is already 2026 in Tokyo.
    expect(formatDay('2025-12-31T23:30:00.000Z', now, 'UTC')).toBe('31 Dec 2025');
    expect(formatDay('2025-12-31T23:30:00.000Z', now, 'Asia/Tokyo')).toBe('1 Jan');
  });

  it('names today and yesterday, and dates everything else', () => {
    expect(formatDayHeading('2026-11-11T01:00:00.000Z', now, 'UTC')).toBe('Today');
    expect(formatDayHeading('2026-11-10T23:00:00.000Z', now, 'UTC')).toBe('Yesterday');
    expect(formatDayHeading('2026-11-09T23:00:00.000Z', now, 'UTC')).toBe('9 Nov');
    // For a viewer in Tokyo, 10 November 23:00 UTC is already today.
    expect(formatDayHeading('2026-11-10T23:00:00.000Z', now, 'Asia/Tokyo')).toBe('Today');
  });

  it("gives the viewer's calendar day of a time", () => {
    expect(dayKey('2026-11-10T23:30:00.000Z', 'UTC')).toBe('2026-11-10');
    expect(dayKey('2026-11-10T23:30:00.000Z', 'Asia/Tokyo')).toBe('2026-11-11');
  });

  it('shows a date without a time as that calendar day in every time zone', () => {
    expect(formatDate('2026-12-01', now, 'UTC')).toBe('1 Dec');
    expect(formatDate('2026-12-01', now, 'America/Los_Angeles')).toBe('1 Dec');
    expect(formatDate('2027-03-01', now, 'Asia/Tokyo')).toBe('1 Mar 2027');
  });

  it('knows a date from other text', () => {
    expect(isDateOnly('2026-11-11')).toBe(true);
    expect(isDateOnly('2026-13-45')).toBe(false);
    expect(isDateOnly('11 Nov')).toBe(false);
    expect(isDateOnly(20261111)).toBe(false);
  });

  it('turns a day of the date filter into the first and the last moment of that local day', () => {
    const start = new Date(dayBoundary('2026-11-11', 'start'));
    const end = new Date(dayBoundary('2026-11-11', 'end'));
    expect([start.getFullYear(), start.getMonth(), start.getDate()]).toEqual([2026, 10, 11]);
    expect([start.getHours(), start.getMinutes(), start.getSeconds()]).toEqual([0, 0, 0]);
    expect([end.getDate(), end.getHours(), end.getMinutes(), end.getSeconds()]).toEqual([
      11, 23, 59, 59,
    ]);
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000 - 1);
  });
});
