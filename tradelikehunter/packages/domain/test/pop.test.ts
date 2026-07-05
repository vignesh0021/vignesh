import { describe, expect, it } from 'vitest';

import { probAbove, probabilityOfProfit, type Leg } from '../src/index';

describe('probAbove', () => {
  it('is monotonically decreasing in the level', () => {
    const p90 = probAbove(100, 90, 1, 0.05, 0.2);
    const p100 = probAbove(100, 100, 1, 0.05, 0.2);
    const p110 = probAbove(100, 110, 1, 0.05, 0.2);
    expect(p90).toBeGreaterThan(p100);
    expect(p100).toBeGreaterThan(p110);
  });

  it('matches the closed form at the money (N(d2) ≈ 0.5596)', () => {
    expect(probAbove(100, 100, 1, 0.05, 0.2)).toBeCloseTo(0.5596, 3);
  });

  it('is bounded to [0,1]', () => {
    expect(probAbove(100, 500, 0.25, 0.05, 0.3)).toBeGreaterThanOrEqual(0);
    expect(probAbove(100, 10, 0.25, 0.05, 0.3)).toBeLessThanOrEqual(1);
  });
});

describe('probabilityOfProfit', () => {
  const strangle = (put: number, call: number): Leg[] => [
    { kind: 'OPTION', optType: 'PUT', action: 'SELL', strike: put, entryPrice: 5, size: 1, iv: 0.2, timeYears: 0.25 },
    { kind: 'OPTION', optType: 'CALL', action: 'SELL', strike: call, entryPrice: 5, size: 1, iv: 0.2, timeYears: 0.25 },
  ];

  it('returns a probability in (0,1) for a short strangle', () => {
    const pop = probabilityOfProfit(strangle(90, 110), 100, 0.25, 0.05, 0.2);
    expect(pop).toBeGreaterThan(0);
    expect(pop).toBeLessThan(1);
  });

  it('a wider strangle has a higher probability of profit', () => {
    const narrow = probabilityOfProfit(strangle(95, 105), 100, 0.25, 0.05, 0.2);
    const wide = probabilityOfProfit(strangle(80, 120), 100, 0.25, 0.05, 0.2);
    expect(wide).toBeGreaterThan(narrow);
  });
});
