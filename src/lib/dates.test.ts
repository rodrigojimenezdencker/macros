import { describe, expect, it } from 'vitest';
import { addDays, isISODate, lastNDays, relativeLabel, toISODate } from './dates';

describe('dates', () => {
  it('formats local calendar days', () => {
    expect(toISODate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('lists the last N days ending on a date', () => {
    expect(lastNDays('2026-10-14', 3)).toEqual(['2026-10-12', '2026-10-13', '2026-10-14']);
  });

  it('never throws on malformed stored dates', () => {
    expect(relativeLabel('abc', '2026-10-14')).toBe('Abc');
    expect(isISODate('2026-10-14')).toBe(true);
    expect(isISODate('2026-13-45x')).toBe(false);
    expect(isISODate('2026-02-30')).toBe(false);
    expect(isISODate('2024-02-29')).toBe(true);
    expect(isISODate(undefined)).toBe(false);
  });

  it('labels nearby days in Spanish', () => {
    expect(relativeLabel('2026-10-14', '2026-10-14')).toBe('Hoy');
    expect(relativeLabel('2026-10-13', '2026-10-14')).toBe('Ayer');
    expect(relativeLabel('2026-10-10', '2026-10-14')).toMatch(/^Sábado, 10 de octubre$/);
  });
});
