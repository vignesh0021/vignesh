import { describe, expect, it } from 'vitest';

import { bsGreeks, type BsInputs } from '../src/index';

const base: Omit<BsInputs, 'type'> = { spot: 100, strike: 100, timeYears: 1, rate: 0.05, iv: 0.2 };

describe('bsGreeks', () => {
  it('matches known delta / gamma / vega for the canonical case', () => {
    const c = bsGreeks({ ...base, type: 'CALL' });
    expect(c.delta).toBeCloseTo(0.6368, 3);
    expect(c.gamma).toBeCloseTo(0.018762, 4);
    expect(c.vega).toBeCloseTo(0.3752, 3); // per 1% IV
  });

  it('put delta = call delta - 1 (parity)', () => {
    const c = bsGreeks({ ...base, type: 'CALL' });
    const p = bsGreeks({ ...base, type: 'PUT' });
    expect(p.delta).toBeCloseTo(c.delta - 1, 6);
    expect(p.gamma).toBeCloseTo(c.gamma, 6); // gamma identical for call & put
    expect(p.vega).toBeCloseTo(c.vega, 6);
  });

  it('long call bleeds theta (daily, negative) and is vega-positive', () => {
    const c = bsGreeks({ ...base, type: 'CALL' });
    expect(c.theta).toBeLessThan(0);
    expect(c.theta).toBeCloseTo(-0.01757, 4);
    expect(c.vega).toBeGreaterThan(0);
    expect(c.gamma).toBeGreaterThan(0);
  });

  it('collapses to a delta step at expiry', () => {
    const itm = bsGreeks({ ...base, timeYears: 0, spot: 120, type: 'CALL' });
    expect(itm.delta).toBe(1);
    expect(itm.gamma).toBe(0);
    expect(itm.vega).toBe(0);
    expect(itm.theta).toBe(0);
  });
});
