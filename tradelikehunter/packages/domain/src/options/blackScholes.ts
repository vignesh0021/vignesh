import { normCdf } from './normal.js';

export type OptionType = 'CALL' | 'PUT';

export interface BsInputs {
  /** Spot price of the underlyer (S). */
  spot: number;
  /** Strike price (K). */
  strike: number;
  /** Time to expiry in years (T = days / 365). */
  timeYears: number;
  /** Risk-free rate, decimal (r). */
  rate: number;
  /** Implied volatility, decimal (σ). */
  iv: number;
  type: OptionType;
}

/** Intrinsic value of an option (no time value). */
export function intrinsic(type: OptionType, spot: number, strike: number): number {
  return type === 'CALL' ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
}

export interface D1D2 {
  d1: number;
  d2: number;
  sqrtT: number;
}

export function d1d2(i: BsInputs): D1D2 {
  const sqrtT = Math.sqrt(i.timeYears);
  const vol = i.iv * sqrtT;
  const d1 = (Math.log(i.spot / i.strike) + (i.rate + 0.5 * i.iv * i.iv) * i.timeYears) / vol;
  return { d1, d2: d1 - vol, sqrtT };
}

/**
 * Black-Scholes-Merton price for a European option. Degenerates to intrinsic
 * value at/after expiry or with non-positive vol/spot.
 */
export function bsPrice(i: BsInputs): number {
  if (i.timeYears <= 0 || i.iv <= 0 || i.spot <= 0) {
    return intrinsic(i.type, i.spot, i.strike);
  }
  const { d1, d2 } = d1d2(i);
  const disc = Math.exp(-i.rate * i.timeYears);
  if (i.type === 'CALL') {
    return i.spot * normCdf(d1) - i.strike * disc * normCdf(d2);
  }
  return i.strike * disc * normCdf(-d2) - i.spot * normCdf(-d1);
}

/**
 * Implied volatility that reprices the option to `targetPrice`. Bisection on
 * σ ∈ [0.1%, 500%] — robust because price is monotonic in vol. Returns a small
 * floor when the quote is at/below intrinsic (no time value to imply).
 */
export function impliedVol(targetPrice: number, i: Omit<BsInputs, 'iv'>): number {
  if (i.timeYears <= 0) return 0.005;
  const iv0 = intrinsic(i.type, i.spot, i.strike);
  if (targetPrice <= iv0 + 1e-9) return 0.005;

  let lo = 0.001;
  let hi = 5;
  for (let k = 0; k < 100; k++) {
    const mid = (lo + hi) / 2;
    const price = bsPrice({ ...i, iv: mid });
    if (price > targetPrice) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}
