import { addDays, calendarDaysBetween, daysInMonth, formatDateOnly, isDateOnly, todayInBusinessTz, weekdayOf } from '@/lib/dates';

describe('date-only primitives', () => {
  it('validates YYYY-MM-DD strictly', () => {
    expect(isDateOnly('2026-11-18')).toBe(true);
    expect(isDateOnly('2026-02-29')).toBe(false);
    expect(isDateOnly('2028-02-29')).toBe(true);
    expect(isDateOnly('2026-13-01')).toBe(false);
    expect(isDateOnly('18/11/2026')).toBe(false);
  });

  it('counts calendar days across month and year boundaries', () => {
    expect(calendarDaysBetween('2026-11-18', '2026-11-18')).toBe(0);
    expect(calendarDaysBetween('2026-01-31', '2026-02-01')).toBe(1);
    expect(calendarDaysBetween('2026-12-30', '2027-01-02')).toBe(3);
    expect(calendarDaysBetween('2028-02-28', '2028-03-01')).toBe(2); // leap year
    expect(calendarDaysBetween('2026-11-20', '2026-11-18')).toBe(-2);
  });

  it('adds days across boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('knows month lengths and weekdays', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(weekdayOf('2026-11-18')).toBe(3); // Wednesday
    expect(formatDateOnly('2026-11-18')).toBe('Wed, 18 Nov 2026');
  });

  it('derives "today" in Asia/Manila (UTC+8), independent of device timezone', () => {
    expect(todayInBusinessTz(new Date('2026-11-18T15:59:59Z'))).toBe('2026-11-18');
    expect(todayInBusinessTz(new Date('2026-11-18T16:00:00Z'))).toBe('2026-11-19');
    expect(todayInBusinessTz(new Date('2026-12-31T16:30:00Z'))).toBe('2027-01-01');
  });
});
