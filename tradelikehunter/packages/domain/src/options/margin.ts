import { intrinsic } from './blackScholes.js';
import { legSign, type Leg } from '../models.js';

/**
 * Simplified SPAN-style margin estimate for the paper-trading simulator (not an
 * exchange-exact figure). Long options cost their premium; short options and
 * futures carry an exposure-based requirement.
 */
export interface MarginParams {
  /** Futures/short exposure factor applied to notional. Default 12%. */
  exposurePct?: number;
  /** Minimum short-option requirement as a fraction of notional. Default 5%. */
  minShortPct?: number;
}

export function legMargin(leg: Leg, spot: number, params: MarginParams = {}): number {
  const exposurePct = params.exposurePct ?? 0.12;
  const minShortPct = params.minShortPct ?? 0.05;
  const notional = spot * leg.size;

  if (leg.kind === 'FUTURE') {
    return exposurePct * notional;
  }
  // Long option: risk is capped at the premium paid.
  if (legSign(leg) > 0) {
    return leg.entryPrice * leg.size;
  }
  // Short option: premium collected + a shocked exposure less the OTM cushion.
  const otm = intrinsic(
    leg.optType === 'PUT' ? 'CALL' : 'PUT', // distance the option is OTM
    spot,
    leg.strike,
  );
  const shocked = Math.max(exposurePct * spot - otm, minShortPct * spot);
  return (leg.entryPrice + shocked) * leg.size;
}

/** Conservative portfolio margin: sum of leg requirements (no cross-netting). */
export function portfolioMargin(legs: readonly Leg[], spot: number, params: MarginParams = {}): number {
  let sum = 0;
  for (const leg of legs) sum += legMargin(leg, spot, params);
  return sum;
}
