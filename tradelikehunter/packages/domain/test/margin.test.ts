import { describe, expect, it } from 'vitest';

import { legMargin, portfolioMargin, type Leg } from '../src/index';

const leg = (o: Partial<Leg>): Leg => ({
  kind: 'OPTION',
  optType: 'CALL',
  action: 'BUY',
  strike: 100,
  entryPrice: 8,
  size: 1,
  iv: 0.2,
  timeYears: 0.25,
  ...o,
});

describe('legMargin', () => {
  it('long option margin equals the premium paid', () => {
    expect(legMargin(leg({ action: 'BUY', entryPrice: 8, size: 2 }), 100)).toBe(16);
  });

  it('short option margin exceeds the premium (carries exposure)', () => {
    const short = legMargin(leg({ action: 'SELL', entryPrice: 8 }), 100);
    expect(short).toBeGreaterThan(8);
  });

  it('future margin is an exposure fraction of notional', () => {
    const m = legMargin(leg({ kind: 'FUTURE', action: 'BUY', size: 1, optType: undefined }), 100);
    expect(m).toBeCloseTo(0.12 * 100, 6);
  });

  it('respects a custom exposure factor', () => {
    const m = legMargin(leg({ kind: 'FUTURE', action: 'BUY', optType: undefined }), 100, { exposurePct: 0.2 });
    expect(m).toBeCloseTo(20, 6);
  });
});

describe('portfolioMargin', () => {
  it('sums leg requirements', () => {
    const legs: Leg[] = [
      leg({ action: 'BUY', entryPrice: 8 }),
      leg({ action: 'SELL', strike: 110, entryPrice: 5 }),
    ];
    const total = portfolioMargin(legs, 100);
    expect(total).toBeCloseTo(legMargin(legs[0]!, 100) + legMargin(legs[1]!, 100), 6);
    expect(total).toBeGreaterThan(0);
  });
});
