import { describe, expect, it } from 'vitest';

import { bsPrice, impliedVol, intrinsic, type BsInputs } from '../src/index';

// Canonical textbook case: S=100, K=100, T=1, r=5%, σ=20%
const base: Omit<BsInputs, 'type'> = { spot: 100, strike: 100, timeYears: 1, rate: 0.05, iv: 0.2 };

describe('bsPrice', () => {
  it('matches known call & put values', () => {
    expect(bsPrice({ ...base, type: 'CALL' })).toBeCloseTo(10.4506, 3);
    expect(bsPrice({ ...base, type: 'PUT' })).toBeCloseTo(5.5735, 3);
  });

  it('satisfies put-call parity  C - P = S - K·e^(-rT)', () => {
    const c = bsPrice({ ...base, type: 'CALL' });
    const p = bsPrice({ ...base, type: 'PUT' });
    const parity = base.spot - base.strike * Math.exp(-base.rate * base.timeYears);
    expect(c - p).toBeCloseTo(parity, 6);
  });

  it('returns intrinsic value at expiry', () => {
    expect(bsPrice({ ...base, timeYears: 0, spot: 120, type: 'CALL' })).toBe(20);
    expect(bsPrice({ ...base, timeYears: 0, spot: 80, type: 'PUT' })).toBe(20);
    expect(bsPrice({ ...base, timeYears: 0, spot: 90, type: 'CALL' })).toBe(0);
  });

  it('deep ITM call approaches S - K·e^(-rT)', () => {
    const price = bsPrice({ ...base, spot: 1000, type: 'CALL' });
    expect(price).toBeCloseTo(1000 - 100 * Math.exp(-0.05), 2);
  });

  it('intrinsic() is never negative', () => {
    expect(intrinsic('CALL', 90, 100)).toBe(0);
    expect(intrinsic('PUT', 110, 100)).toBe(0);
    expect(intrinsic('CALL', 110, 100)).toBe(10);
  });
});

describe('impliedVol', () => {
  it('round-trips the volatility used to price', () => {
    for (const iv of [0.1, 0.2, 0.35, 0.6]) {
      const price = bsPrice({ ...base, iv, type: 'CALL' });
      const solved = impliedVol(price, { ...base, type: 'CALL' });
      expect(solved).toBeCloseTo(iv, 3);
    }
  });

  it('floors at/below intrinsic', () => {
    expect(impliedVol(0.0001, { ...base, spot: 120, type: 'CALL' })).toBeCloseTo(0.005, 4);
  });
});
