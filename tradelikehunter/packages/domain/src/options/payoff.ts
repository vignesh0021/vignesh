import { legSign, type Greeks, type Leg } from '../models.js';
import { bsPrice, intrinsic } from './blackScholes.js';
import { bsGreeks } from './greeks.js';

/** PNL of one leg at terminal expiry for spot X. */
export function legExpiryPnl(leg: Leg, spot: number): number {
  const value =
    leg.kind === 'FUTURE' ? spot : intrinsic(leg.optType ?? 'CALL', spot, leg.strike);
  return legSign(leg) * (value - leg.entryPrice) * leg.size;
}

/** Theoretical PNL of one leg now (Black-Scholes for options, linear for futures). */
export function legValuePnl(leg: Leg, spot: number, rate: number): number {
  if (leg.kind === 'FUTURE') {
    return legSign(leg) * (spot - leg.entryPrice) * leg.size;
  }
  const price = bsPrice({
    spot,
    strike: leg.strike,
    timeYears: leg.timeYears,
    rate,
    iv: leg.iv,
    type: leg.optType ?? 'CALL',
  });
  return legSign(leg) * (price - leg.entryPrice) * leg.size;
}

/** Position-scaled Greeks for one leg (signed & sized). */
export function legGreeks(leg: Leg, spot: number, rate: number): Greeks {
  const k = legSign(leg) * leg.size;
  if (leg.kind === 'FUTURE') {
    return { delta: k, gamma: 0, theta: 0, vega: 0, rho: 0 };
  }
  const g = bsGreeks({
    spot,
    strike: leg.strike,
    timeYears: leg.timeYears,
    rate,
    iv: leg.iv,
    type: leg.optType ?? 'CALL',
  });
  return { delta: g.delta * k, gamma: g.gamma * k, theta: g.theta * k, vega: g.vega * k, rho: g.rho * k };
}

export function portfolioExpiryPnl(legs: readonly Leg[], spot: number): number {
  let sum = 0;
  for (const leg of legs) sum += legExpiryPnl(leg, spot);
  return sum;
}

export function portfolioValuePnl(legs: readonly Leg[], spot: number, rate: number): number {
  let sum = 0;
  for (const leg of legs) sum += legValuePnl(leg, spot, rate);
  return sum;
}

export function aggregateGreeks(legs: readonly Leg[], spot: number, rate: number): Greeks {
  const total: Greeks = { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
  for (const leg of legs) {
    const g = legGreeks(leg, spot, rate);
    total.delta += g.delta;
    total.gamma += g.gamma;
    total.theta += g.theta;
    total.vega += g.vega;
    total.rho += g.rho;
  }
  return total;
}

export interface RiskSummary {
  maxProfit: number;
  maxLoss: number;
  maxProfitUnbounded: boolean;
  maxLossUnbounded: boolean;
  breakevens: number[];
  rewardRisk: number | null;
}

/**
 * Break-evens, max profit / loss on the EXPIRY curve, scanning a wide grid and
 * inspecting the tail slopes to flag unbounded exposure.
 */
export function computeRisk(legs: readonly Leg[], spot: number): RiskSummary {
  const lo = Math.max(spot * 0.2, 1);
  const hi = spot * 2.5;
  const steps = 500;
  const dx = (hi - lo) / steps;

  const xs: number[] = [];
  const ys: number[] = [];
  let maxProfit = -Infinity;
  let maxLoss = Infinity;
  for (let k = 0; k <= steps; k++) {
    const x = lo + dx * k;
    const y = portfolioExpiryPnl(legs, x);
    xs.push(x);
    ys.push(y);
    if (y > maxProfit) maxProfit = y;
    if (y < maxLoss) maxLoss = y;
  }

  const n = ys.length;
  const eps = 1e-6;
  const leftSlope = (ys[1] as number) - (ys[0] as number);
  const rightSlope = (ys[n - 1] as number) - (ys[n - 2] as number);
  const maxProfitUnbounded = rightSlope > eps || leftSlope < -eps;
  const maxLossUnbounded = rightSlope < -eps || leftSlope > eps;

  const breakevens: number[] = [];
  for (let k = 1; k < n; k++) {
    const a = ys[k - 1] as number;
    const b = ys[k] as number;
    if ((a <= 0 && b > 0) || (a >= 0 && b < 0)) {
      const xa = xs[k - 1] as number;
      const xb = xs[k] as number;
      const t = a / (a - b);
      breakevens.push(xa + t * (xb - xa));
    }
  }

  const rewardRisk =
    !maxLossUnbounded && !maxProfitUnbounded && maxLoss < 0
      ? Math.abs(maxProfit / maxLoss)
      : null;

  return { maxProfit, maxLoss, maxProfitUnbounded, maxLossUnbounded, breakevens, rewardRisk };
}
