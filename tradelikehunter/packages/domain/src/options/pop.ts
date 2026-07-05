import type { Leg } from '../models.js';
import { normCdf } from './normal.js';
import { portfolioExpiryPnl } from './payoff.js';

/**
 * Risk-neutral probability that the underlying finishes **above** `level` at T:
 *   P(S_T > level) = N(d2)  with strike = level.
 */
export function probAbove(
  spot: number,
  level: number,
  timeYears: number,
  rate: number,
  iv: number,
): number {
  if (timeYears <= 0 || iv <= 0) return spot > level ? 1 : 0;
  const d2 =
    (Math.log(spot / level) + (rate - 0.5 * iv * iv) * timeYears) / (iv * Math.sqrt(timeYears));
  return normCdf(d2);
}

export function probBelow(
  spot: number,
  level: number,
  timeYears: number,
  rate: number,
  iv: number,
): number {
  return 1 - probAbove(spot, level, timeYears, rate, iv);
}

/**
 * Probability of profit at expiry for an arbitrary strategy: integrate the
 * risk-neutral lognormal terminal distribution over a price grid and sum the
 * mass where the strategy's expiry PNL is positive. `iv` characterises the
 * terminal distribution (use ATM / portfolio IV).
 */
export function probabilityOfProfit(
  legs: readonly Leg[],
  spot: number,
  timeYears: number,
  rate: number,
  iv: number,
  steps = 2000,
): number {
  if (timeYears <= 0 || iv <= 0) {
    return portfolioExpiryPnl(legs, spot) > 0 ? 1 : 0;
  }
  const vol = iv * Math.sqrt(timeYears);
  const drift = (rate - 0.5 * iv * iv) * timeYears;
  const mu = Math.log(spot) + drift;

  // Integrate over ln(S) ∈ [mu - 6σ, mu + 6σ] with the normal density.
  const loZ = -6;
  const hiZ = 6;
  const dz = (hiZ - loZ) / steps;
  let profitMass = 0;
  let totalMass = 0;
  const invSqrt2pi = 0.3989422804014327;
  for (let k = 0; k <= steps; k++) {
    const z = loZ + dz * k;
    const w = invSqrt2pi * Math.exp(-0.5 * z * z); // standard normal density
    const priceAtExpiry = Math.exp(mu + vol * z);
    totalMass += w;
    if (portfolioExpiryPnl(legs, priceAtExpiry) > 0) profitMass += w;
  }
  return totalMass > 0 ? profitMass / totalMass : 0;
}
