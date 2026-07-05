import { describe, expect, it } from 'vitest';

import { aggregateGreeks, computeRisk, legExpiryPnl, legGreeks, type Leg } from '../src/index';

const opt = (o: Partial<Leg>): Leg => ({
  kind: 'OPTION',
  optType: 'CALL',
  action: 'BUY',
  strike: 100,
  entryPrice: 10,
  size: 1,
  iv: 0.2,
  timeYears: 0.25,
  ...o,
});

describe('legExpiryPnl', () => {
  it('prices a long call at expiry', () => {
    const call = opt({ entryPrice: 10 });
    expect(legExpiryPnl(call, 90)).toBe(-10); // OTM → lose premium
    expect(legExpiryPnl(call, 130)).toBe(20); // intrinsic 30 − 10
  });

  it('prices a future leg linearly', () => {
    const fut = opt({ kind: 'FUTURE', action: 'BUY', entryPrice: 100, optType: undefined });
    expect(legExpiryPnl(fut, 110)).toBe(10);
    expect(legExpiryPnl(fut, 95)).toBe(-5);
  });
});

describe('legGreeks', () => {
  it('a future is pure delta ±size', () => {
    const longFut = legGreeks(opt({ kind: 'FUTURE', action: 'BUY', size: 3 }), 100, 0.05);
    expect(longFut.delta).toBe(3);
    expect(longFut.gamma).toBe(0);
    const shortFut = legGreeks(opt({ kind: 'FUTURE', action: 'SELL', size: 2 }), 100, 0.05);
    expect(shortFut.delta).toBe(-2);
  });

  it('aggregates a long call to positive delta', () => {
    const g = aggregateGreeks([opt({ strike: 100, timeYears: 1 })], 100, 0.05);
    expect(g.delta).toBeGreaterThan(0);
    expect(g.theta).toBeLessThan(0);
  });
});

describe('computeRisk — bull call spread (debit)', () => {
  const legs: Leg[] = [
    opt({ optType: 'CALL', action: 'BUY', strike: 100, entryPrice: 10 }),
    opt({ optType: 'CALL', action: 'SELL', strike: 110, entryPrice: 5 }),
  ];
  const r = computeRisk(legs, 100);

  it('has bounded, correct max profit and loss', () => {
    expect(r.maxProfitUnbounded).toBe(false);
    expect(r.maxLossUnbounded).toBe(false);
    expect(r.maxProfit).toBeCloseTo(5, 1); // width 10 − debit 5
    expect(r.maxLoss).toBeCloseTo(-5, 1); // net debit
  });

  it('breaks even at long strike + debit ≈ 105', () => {
    expect(r.breakevens.length).toBe(1);
    expect(r.breakevens[0]).toBeCloseTo(105, 0);
  });

  it('reward:risk ≈ 1', () => {
    expect(r.rewardRisk).toBeCloseTo(1, 1);
  });
});

describe('computeRisk — short strangle', () => {
  const legs: Leg[] = [
    opt({ optType: 'PUT', action: 'SELL', strike: 90, entryPrice: 5 }),
    opt({ optType: 'CALL', action: 'SELL', strike: 110, entryPrice: 5 }),
  ];
  const r = computeRisk(legs, 100);

  it('caps profit at the credit and is loss-unbounded', () => {
    expect(r.maxProfit).toBeCloseTo(10, 1); // credit collected
    expect(r.maxLossUnbounded).toBe(true);
    expect(r.rewardRisk).toBeNull();
    expect(r.breakevens.length).toBe(2); // 80 and 120
  });
});
