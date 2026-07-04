import {
  bsGreeks,
  bsPrice,
  intrinsic,
  type BsInputs,
} from '../hooks/useBlackScholes';
import type { Greeks, OptionPosition } from '../types';
import { daysBetween } from './format';

/**
 * Module 2 analytics — payoff synthesis with the "Closed Position Baseline".
 *
 * Sign convention: BUY = +1 (long, pay premium), SELL = -1 (short, collect
 * premium). All PNL is in quote currency (USD) and already multiplied by the
 * economic size `lots * lotSize`.
 */

export function legSign(pos: OptionPosition): number {
  return pos.action === 'BUY' ? 1 : -1;
}

export function legSize(pos: OptionPosition): number {
  return pos.lots * pos.lotSize;
}

/** Frozen realized PNL for a leg being closed at `exitPremium`. */
export function realizedPnlFor(pos: OptionPosition, exitPremium: number): number {
  return legSign(pos) * (exitPremium - pos.entryPremium) * legSize(pos);
}

/** PNL of a single OPEN leg at expiry for a given terminal spot X. */
export function legExpiryPnl(pos: OptionPosition, spot: number): number {
  const value = intrinsic(pos.type, spot, pos.strike);
  return legSign(pos) * (value - pos.entryPremium) * legSize(pos);
}

/**
 * PNL of a single OPEN leg *right now* (T+0-style), valued with Black-Scholes
 * at an arbitrary evaluation date, spot and IV shift.
 */
export function legValuePnl(
  pos: OptionPosition,
  spot: number,
  evalDateIso: string,
  ivShift: number,
  rate: number,
): number {
  const days = Math.max(daysBetween(evalDateIso, pos.expiry), 0);
  const inputs: BsInputs = {
    spot,
    strike: pos.strike,
    timeYears: days / 365,
    rate,
    iv: Math.max(pos.iv + ivShift, 0.0001),
    type: pos.type,
  };
  const price = bsPrice(inputs);
  return legSign(pos) * (price - pos.entryPremium) * legSize(pos);
}

/** Sum of frozen realized PNL — the vertical baseline offset for the curves. */
export function closedOffset(closed: OptionPosition[]): number {
  return closed.reduce((acc, p) => acc + (p.realizedPnl ?? 0), 0);
}

export interface CurveParams {
  open: OptionPosition[];
  closed: OptionPosition[];
  rate: number;
  ivShift: number;
  evalDateIso: string;
}

/**
 * Total portfolio PNL at terminal expiry for spot X:
 *   activeExpiryPayoff(X) + closedOffset
 */
export function portfolioExpiryPnl(X: number, p: CurveParams): number {
  let sum = 0;
  for (const pos of p.open) sum += legExpiryPnl(pos, X);
  return sum + closedOffset(p.closed);
}

/**
 * Total portfolio PNL "now" (T+0) at spot X, using the simulated eval date /
 * IV shift, plus the frozen closed offset.
 */
export function portfolioValuePnl(X: number, p: CurveParams): number {
  let sum = 0;
  for (const pos of p.open) {
    sum += legValuePnl(pos, X, p.evalDateIso, p.ivShift, p.rate);
  }
  return sum + closedOffset(p.closed);
}

/** Net Greeks across all OPEN legs. Closed legs contribute exactly 0. */
export function aggregateGreeks(
  open: OptionPosition[],
  spot: number,
  evalDateIso: string,
  ivShift: number,
  rate: number,
): Greeks {
  const total: Greeks = { delta: 0, gamma: 0, theta: 0, vega: 0 };
  for (const pos of open) {
    const g = legGreeks(pos, spot, evalDateIso, ivShift, rate);
    total.delta += g.delta;
    total.gamma += g.gamma;
    total.theta += g.theta;
    total.vega += g.vega;
  }
  return total;
}

/** Position-scaled Greeks for one leg (signed & sized). */
export function legGreeks(
  pos: OptionPosition,
  spot: number,
  evalDateIso: string,
  ivShift: number,
  rate: number,
): Greeks {
  const days = Math.max(daysBetween(evalDateIso, pos.expiry), 0);
  const g = bsGreeks({
    spot,
    strike: pos.strike,
    timeYears: days / 365,
    rate,
    iv: Math.max(pos.iv + ivShift, 0.0001),
    type: pos.type,
  });
  const k = legSign(pos) * legSize(pos);
  return {
    delta: g.delta * k,
    gamma: g.gamma * k,
    theta: g.theta * k,
    vega: g.vega * k,
  };
}

export interface PayoffSample {
  spot: number;
  expiry: number;
  value: number;
}

/** Build a grid of payoff samples spanning [min, max]. */
export function buildPayoffCurve(
  p: CurveParams,
  min: number,
  max: number,
  steps = 120,
): PayoffSample[] {
  const out: PayoffSample[] = [];
  const dx = (max - min) / steps;
  for (let i = 0; i <= steps; i++) {
    const x = min + dx * i;
    out.push({
      spot: x,
      expiry: portfolioExpiryPnl(x, p),
      value: portfolioValuePnl(x, p),
    });
  }
  return out;
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
 * Max profit / max loss / break-even points computed off the EXPIRY curve,
 * scanning a wide grid and inspecting the tail slopes to detect unbounded
 * exposure (naked shorts → unlimited loss, long underlying-like → unlimited
 * profit).
 */
export function computeRisk(p: CurveParams, spot: number): RiskSummary {
  const lo = Math.max(spot * 0.2, 1);
  const hi = spot * 2.5;
  const samples = buildPayoffCurve(p, lo, hi, 400).map((s) => ({
    x: s.spot,
    y: s.expiry,
  }));

  let maxProfit = -Infinity;
  let maxLoss = Infinity;
  for (const s of samples) {
    if (s.y > maxProfit) maxProfit = s.y;
    if (s.y < maxLoss) maxLoss = s.y;
  }

  // Tail-slope analysis for unbounded detection.
  const n = samples.length;
  const leftSlope = samples[1].y - samples[0].y;
  const rightSlope = samples[n - 1].y - samples[n - 2].y;
  const eps = 1e-6;

  const maxProfitUnbounded = rightSlope > eps || leftSlope < -eps;
  const maxLossUnbounded = rightSlope < -eps || leftSlope > eps;

  // Break-evens: sign changes on the expiry curve, linearly interpolated.
  const breakevens: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if ((a.y <= 0 && b.y > 0) || (a.y >= 0 && b.y < 0)) {
      const t = a.y / (a.y - b.y);
      breakevens.push(a.x + t * (b.x - a.x));
    }
  }

  const rr =
    !maxLossUnbounded && !maxProfitUnbounded && maxLoss < 0
      ? Math.abs(maxProfit / maxLoss)
      : null;

  return {
    maxProfit,
    maxLoss,
    maxProfitUnbounded,
    maxLossUnbounded,
    breakevens,
    rewardRisk: rr,
  };
}
