import { describe, expect, it } from 'vitest';
import { niceTicks } from './charts';

describe('niceTicks', () => {
  it('covers the range with round steps', () => {
    expect(niceTicks(0, 2200)).toEqual([0, 1000, 2000, 3000]);
    expect(niceTicks(0, 2000)).toEqual([0, 500, 1000, 1500, 2000]);
    expect(niceTicks(77.75, 79.25)).toEqual([77.5, 78, 78.5, 79, 79.5]);
  });

  it('handles a flat range', () => {
    const t = niceTicks(80, 80);
    expect(t[0]).toBeLessThanOrEqual(80);
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(81);
  });

  it('always terminates, even where floats cannot step', () => {
    for (const v of [2 ** 51, 2 ** 52, 9e15, 1e300]) {
      const t = niceTicks(v - 0.25, v + 0.25);
      expect(t.length).toBeGreaterThan(0);
      expect(t.length).toBeLessThanOrEqual(12);
    }
    expect(niceTicks(NaN, 5)).toEqual([0, 1]);
    expect(niceTicks(0, Infinity)).toEqual([0, 1]);
  });
});
