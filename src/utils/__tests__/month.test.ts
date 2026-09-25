import { endOfMonth, monthKey, moveMonth, parseMonthKey, startOfMonth } from '@/utils/date';

describe('month helpers', () => {
  it('moves across year boundaries in both directions', () => {
    expect(moveMonth('2026-12-01', 1)).toBe('2027-01-01');
    expect(moveMonth('2026-01-01', -1)).toBe('2025-12-01');
    expect(moveMonth('2026-09-01', -13)).toBe('2025-08-01');
  });

  it('lands on the first of the month even from the 31st', () => {
    // setMonth on the 31st would overflow into the following month.
    expect(moveMonth('2026-01-31', 1)).toBe('2026-02-01');
    expect(moveMonth('2026-03-31', -1)).toBe('2026-02-01');
  });

  it('derives a month key that round-trips', () => {
    expect(monthKey('2026-09-25')).toBe('2026-09');
    expect(parseMonthKey(monthKey('2026-09-25'))).toBe('2026-09-01');
    expect(endOfMonth(parseMonthKey('2024-02') ?? '')).toBe('2024-02-29');
    expect(startOfMonth('2026-09-25')).toBe('2026-09-01');
  });

  it('rejects malformed or out-of-range keys', () => {
    for (const bad of [undefined, null, 42, '', '2026', '2026-9', '2026-13', '2026-00', '2026-09-01', ' 2026-09', ['2026-09']]) {
      expect(parseMonthKey(bad)).toBeNull();
    }
  });
});
