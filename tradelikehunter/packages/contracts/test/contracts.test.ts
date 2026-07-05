import { describe, expect, it } from 'vitest';

import { BuildStrategyInput, LoginInput, OrderInput, RegisterInput } from '../src/index';

describe('OrderInput', () => {
  const marketBuy = {
    instrumentKind: 'OPTION',
    instrumentRef: 'NIFTY24AUG24200CE',
    side: 'BUY',
    type: 'MARKET',
    qtyLots: 1,
  };

  it('accepts a valid market order and applies defaults', () => {
    const r = OrderInput.parse(marketBuy);
    expect(r.product).toBe('NRML');
    expect(r.tif).toBe('DAY');
  });

  it('rejects a LIMIT order without a price', () => {
    const r = OrderInput.safeParse({ ...marketBuy, type: 'LIMIT' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some((i) => i.path.includes('price'))).toBe(true);
  });

  it('requires both price and trigger for SL', () => {
    expect(OrderInput.safeParse({ ...marketBuy, type: 'SL', price: 100 }).success).toBe(false);
    expect(OrderInput.safeParse({ ...marketBuy, type: 'SL', price: 100, triggerPrice: 105 }).success).toBe(true);
  });

  it('requires a trigger for SL-M', () => {
    expect(OrderInput.safeParse({ ...marketBuy, type: 'SL_M' }).success).toBe(false);
    expect(OrderInput.safeParse({ ...marketBuy, type: 'SL_M', triggerPrice: 105 }).success).toBe(true);
  });

  it('rejects non-positive / non-integer lots', () => {
    expect(OrderInput.safeParse({ ...marketBuy, qtyLots: 0 }).success).toBe(false);
    expect(OrderInput.safeParse({ ...marketBuy, qtyLots: 1.5 }).success).toBe(false);
  });
});

describe('auth', () => {
  it('enforces email + min password length', () => {
    expect(RegisterInput.safeParse({ email: 'a@b.com', password: 'longenough', displayName: 'Hunter' }).success).toBe(true);
    expect(RegisterInput.safeParse({ email: 'nope', password: 'longenough', displayName: 'Hunter' }).success).toBe(false);
    expect(RegisterInput.safeParse({ email: 'a@b.com', password: 'short', displayName: 'Hunter' }).success).toBe(false);
  });

  it('login needs a non-empty password', () => {
    expect(LoginInput.safeParse({ email: 'a@b.com', password: '' }).success).toBe(false);
  });
});

describe('BuildStrategyInput', () => {
  const leg = { kind: 'OPTION', optType: 'CALL', action: 'SELL', strike: 24200, lots: 1 };

  it('accepts a well-formed strategy', () => {
    const r = BuildStrategyInput.safeParse({ underlyingSymbol: 'NIFTY', expiry: '2026-08-28', legs: [leg] });
    expect(r.success).toBe(true);
  });

  it('requires at least one leg', () => {
    expect(BuildStrategyInput.safeParse({ underlyingSymbol: 'NIFTY', expiry: '2026-08-28', legs: [] }).success).toBe(false);
  });

  it('rejects a bad expiry format and an option leg missing CALL/PUT', () => {
    expect(BuildStrategyInput.safeParse({ underlyingSymbol: 'NIFTY', expiry: '28-08-2026', legs: [leg] }).success).toBe(false);
    const noType = { kind: 'OPTION', action: 'SELL', strike: 24200, lots: 1 };
    expect(BuildStrategyInput.safeParse({ underlyingSymbol: 'NIFTY', expiry: '2026-08-28', legs: [noType] }).success).toBe(false);
  });
});
