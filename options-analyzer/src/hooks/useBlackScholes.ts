import { useMemo } from 'react';

import type { Greeks, OptionType, PricedLeg } from '../types';

/**
 * Module 1 — The Black-Scholes-Merton mathematical engine.
 *
 * Fully client-side, dependency-free analytical pricing and risk metrics.
 * All formulas use continuous compounding with a (non-dividend) risk-free
 * rate `r`. Time `T` is expressed in years (days / 365).
 */

const INV_SQRT_2PI = 0.3989422804014327; // 1 / sqrt(2*pi)

/** Standard normal probability density function φ(x). */
export function normPdf(x: number): number {
  return INV_SQRT_2PI * Math.exp(-0.5 * x * x);
}

/**
 * Standard normal cumulative distribution function N(x).
 * Uses the Abramowitz & Stegun 7.1.26 erf approximation (|error| < 1.5e-7).
 */
export function normCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;

  const t = 1 / (1 + 0.3275911 * z);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-z * z);

  return 0.5 * (1 + sign * y);
}

export interface BsInputs {
  /** Spot price of the underlyer (S). */
  spot: number;
  /** Strike price (K). */
  strike: number;
  /** Time to expiration in years (T = days / 365). */
  timeYears: number;
  /** Risk-free interest rate as a decimal (r). */
  rate: number;
  /** Implied volatility as a decimal (σ, e.g. 0.6 = 60%). */
  iv: number;
  type: OptionType;
}

function d1d2(inputs: BsInputs): { d1: number; d2: number; sqrtT: number } {
  const { spot, strike, timeYears, rate, iv } = inputs;
  const sqrtT = Math.sqrt(timeYears);
  const vol = iv * sqrtT;
  const d1 =
    (Math.log(spot / strike) + (rate + 0.5 * iv * iv) * timeYears) / vol;
  const d2 = d1 - vol;
  return { d1, d2, sqrtT };
}

/**
 * Fair price of a European option under Black-Scholes.
 * At/after expiry (T <= 0) or with zero vol, returns intrinsic value.
 */
export function bsPrice(inputs: BsInputs): number {
  const { spot, strike, timeYears, rate, iv, type } = inputs;

  if (timeYears <= 0 || iv <= 0 || spot <= 0) {
    return intrinsic(type, spot, strike);
  }

  const { d1, d2 } = d1d2(inputs);
  const disc = Math.exp(-rate * timeYears);

  if (type === 'CALL') {
    return spot * normCdf(d1) - strike * disc * normCdf(d2);
  }
  return strike * disc * normCdf(-d2) - spot * normCdf(-d1);
}

export function intrinsic(type: OptionType, spot: number, strike: number): number {
  return type === 'CALL'
    ? Math.max(spot - strike, 0)
    : Math.max(strike - spot, 0);
}

/**
 * The full Greeks matrix for a single option.
 * - delta: ∂price/∂spot
 * - gamma: ∂²price/∂spot²
 * - theta: ∂price/∂t expressed as *daily* decay (per calendar day)
 * - vega: ∂price/∂σ expressed per *1% (one vol point)* shift in IV
 */
export function bsGreeks(inputs: BsInputs): Greeks {
  const { spot, strike, timeYears, rate, iv, type } = inputs;

  if (timeYears <= 0 || iv <= 0 || spot <= 0) {
    // Expired / degenerate: delta is a step, everything else collapses to 0.
    const itm = intrinsic(type, spot, strike) > 0;
    return {
      delta: itm ? (type === 'CALL' ? 1 : -1) : 0,
      gamma: 0,
      theta: 0,
      vega: 0,
    };
  }

  const { d1, d2, sqrtT } = d1d2(inputs);
  const pdf = normPdf(d1);
  const disc = Math.exp(-rate * timeYears);

  const delta = type === 'CALL' ? normCdf(d1) : normCdf(d1) - 1;
  const gamma = pdf / (spot * iv * sqrtT);
  const vegaRaw = spot * pdf * sqrtT; // per 1.00 change in σ

  // Annualised theta, then converted to per-calendar-day.
  const term1 = -(spot * pdf * iv) / (2 * sqrtT);
  const thetaAnnual =
    type === 'CALL'
      ? term1 - rate * strike * disc * normCdf(d2)
      : term1 + rate * strike * disc * normCdf(-d2);

  return {
    delta,
    gamma,
    theta: thetaAnnual / 365, // daily decay
    vega: vegaRaw / 100, // per 1% IV move
  };
}

/** Convenience: price + Greeks in one call. */
export function priceLeg(inputs: BsInputs): PricedLeg {
  return { premium: bsPrice(inputs), greeks: bsGreeks(inputs) };
}

/**
 * React hook wrapper — memoises pricing for a single set of inputs so
 * components re-render without recomputing on every frame.
 */
export function useBlackScholes(inputs: BsInputs): PricedLeg {
  return useMemo(
    () => priceLeg(inputs),
    [
      inputs.spot,
      inputs.strike,
      inputs.timeYears,
      inputs.rate,
      inputs.iv,
      inputs.type,
    ],
  );
}
