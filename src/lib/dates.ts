/**
 * Date-only primitives ("YYYY-MM-DD") with no device-timezone dependence.
 * Rental billing rules build on these in src/domain (Phase 7); never re-implement them elsewhere.
 */
import { appConfig } from '@/config/app';

export type DateOnly = string; // YYYY-MM-DD

const RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateOnly(value: string): value is DateOnly {
  const m = RE.exec(value);
  if (!m) return false;
  const [, y, mo, d] = m.map(Number) as [number, number, number, number];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

export function parseDateOnly(value: DateOnly): { year: number; month: number; day: number } {
  const m = RE.exec(value);
  if (!m || !isDateOnly(value)) throw new RangeError(`Invalid date-only value: ${value}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function toDateOnly(year: number, month: number, day: number): DateOnly {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 0 = Sunday … 6 = Saturday */
export function weekdayOf(value: DateOnly): number {
  const { year, month, day } = parseDateOnly(value);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Whole calendar days from `from` to `to` (negative if `to` is earlier). */
export function calendarDaysBetween(from: DateOnly, to: DateOnly): number {
  const a = parseDateOnly(from);
  const b = parseDateOnly(to);
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000);
}

export function addDays(value: DateOnly, days: number): DateOnly {
  const { year, month, day } = parseDateOnly(value);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return toDateOnly(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function compareDateOnly(a: DateOnly, b: DateOnly): number {
  return a < b ? -1 : a > b ? 1 : 0; // lexical order is chronological for YYYY-MM-DD
}

/** Today's calendar date in the business timezone (Asia/Manila, fixed UTC+8). */
export function todayInBusinessTz(now: Date = new Date()): DateOnly {
  const shifted = new Date(now.getTime() + appConfig.businessUtcOffsetMinutes * 60_000);
  return toDateOnly(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function monthLabel(year: number, month: number): string {
  return `${MONTHS[month - 1]} ${year}`;
}

/** e.g. "Tue, 18 Nov 2026" */
export function formatDateOnly(value: DateOnly): string {
  const { year, month, day } = parseDateOnly(value);
  return `${WEEKDAYS_SHORT[weekdayOf(value)]}, ${day} ${MONTHS_SHORT[month - 1]} ${year}`;
}

export const weekdayInitials = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;
export const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
