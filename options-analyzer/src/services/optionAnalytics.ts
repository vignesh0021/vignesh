import { bsGreeks, impliedVol } from '../hooks/useBlackScholes';
import type { ChainRow } from './optionChain';
import { daysBetween, todayIso } from '../utils/format';

/**
 * On-device index-options analytics computed from a live option chain
 * (strike, call/put OI, OI-change, LTP + spot + time-to-expiry). Covers the
 * openalgo-style tool set: Max Pain, PCR, OI build-up, support/resistance,
 * IV smile, expected move, GEX and gamma density — all derived, no server.
 */

export type Buildup = 'LONG_BUILDUP' | 'SHORT_BUILDUP' | 'SHORT_COVERING' | 'LONG_UNWINDING' | 'FLAT';

export interface StrikeAnalytics {
  strike: number;
  callOI: number;
  putOI: number;
  callOIChg: number;
  putOIChg: number;
  callLtp: number;
  putLtp: number;
  callIV: number; // decimal
  putIV: number; // decimal
  callGamma: number;
  putGamma: number;
  /** Per-strike dealer gamma exposure (calls +, puts −), in ₹ per 1% move terms. */
  gex: number;
  /** gamma × OI magnitude, for the density profile. */
  gammaDensity: number;
  callBuildup: Buildup;
  putBuildup: Buildup;
  atm: boolean;
}

export interface OptionAnalytics {
  rows: StrikeAnalytics[];
  spot: number;
  atm: number;
  maxPain: number;
  pcrOI: number;
  totalCallOI: number;
  totalPutOI: number;
  support: number; // max put-OI strike
  resistance: number; // max call-OI strike
  expectedMove: number; // ATM straddle
  expectedMovePct: number;
  netGEX: number;
  gammaFlip: number | null;
  atmIV: number; // decimal
}

function classify(priceChg: number, oiChg: number): Buildup {
  const p = Math.abs(priceChg) > 1e-9;
  const o = Math.abs(oiChg) > 1e-9;
  if (!p || !o) return 'FLAT';
  if (priceChg > 0 && oiChg > 0) return 'LONG_BUILDUP';
  if (priceChg < 0 && oiChg > 0) return 'SHORT_BUILDUP';
  if (priceChg > 0 && oiChg < 0) return 'SHORT_COVERING';
  return 'LONG_UNWINDING';
}

export function computeAnalytics(
  rows: ChainRow[],
  spot: number,
  expiryIso: string,
  rate: number,
  lotSize: number,
): OptionAnalytics | null {
  if (rows.length === 0 || spot <= 0) return null;
  const days = Math.max(daysBetween(todayIso(), expiryIso), 0.25);
  const timeYears = days / 365;

  const atm = rows.reduce((b, r) => (Math.abs(r.strike - spot) < Math.abs(b.strike - spot) ? r : b)).strike;

  let totalCallOI = 0;
  let totalPutOI = 0;
  let maxCallOI = -1;
  let maxPutOI = -1;
  let resistance = atm;
  let support = atm;

  const out: StrikeAnalytics[] = rows.map((r) => {
    const callOI = r.call.oiLacs * 1e5;
    const putOI = r.put.oiLacs * 1e5;
    totalCallOI += callOI;
    totalPutOI += putOI;
    if (callOI > maxCallOI) {
      maxCallOI = callOI;
      resistance = r.strike;
    }
    if (putOI > maxPutOI) {
      maxPutOI = putOI;
      support = r.strike;
    }

    const callIV = impliedVol(r.call.ltp, { spot, strike: r.strike, timeYears, rate, type: 'CALL' });
    const putIV = impliedVol(r.put.ltp, { spot, strike: r.strike, timeYears, rate, type: 'PUT' });
    const callG = bsGreeks({ spot, strike: r.strike, timeYears, rate, iv: callIV, type: 'CALL' }).gamma;
    const putG = bsGreeks({ spot, strike: r.strike, timeYears, rate, iv: putIV, type: 'PUT' }).gamma;
    // Dealer GEX convention: long calls / short puts → calls +, puts −.
    const gex = (callG * callOI - putG * putOI) * lotSize * spot * spot * 0.01;
    const gammaDensity = (callG * callOI + putG * putOI) * lotSize;

    return {
      strike: r.strike,
      callOI,
      putOI,
      callOIChg: r.call.oiChg ?? 0,
      putOIChg: r.put.oiChg ?? 0,
      callLtp: r.call.ltp,
      putLtp: r.put.ltp,
      callIV,
      putIV,
      callGamma: callG,
      putGamma: putG,
      gex,
      gammaDensity,
      callBuildup: classify(r.call.chg, r.call.oiChg ?? 0),
      putBuildup: classify(r.put.chg, r.put.oiChg ?? 0),
      atm: r.strike === atm,
    };
  });

  // Max pain: expiry price (over listed strikes) minimising total ITM payout.
  let maxPain = atm;
  let minPayout = Infinity;
  for (const candidate of rows) {
    const E = candidate.strike;
    let payout = 0;
    for (const r of out) {
      if (E > r.strike) payout += r.callOI * (E - r.strike);
      if (E < r.strike) payout += r.putOI * (r.strike - E);
    }
    if (payout < minPayout) {
      minPayout = payout;
      maxPain = E;
    }
  }

  // Gamma flip / zero-gamma level: strike where cumulative GEX crosses zero.
  let gammaFlip: number | null = null;
  let cum = 0;
  let prevCum = 0;
  for (const r of out) {
    prevCum = cum;
    cum += r.gex;
    if (prevCum <= 0 && cum > 0) gammaFlip = r.strike;
    else if (prevCum >= 0 && cum < 0) gammaFlip = r.strike;
  }

  const atmRow = out.find((r) => r.atm)!;
  const expectedMove = atmRow.callLtp + atmRow.putLtp;
  const netGEX = out.reduce((a, r) => a + r.gex, 0);

  return {
    rows: out,
    spot,
    atm,
    maxPain,
    pcrOI: totalCallOI > 0 ? totalPutOI / totalCallOI : 0,
    totalCallOI,
    totalPutOI,
    support,
    resistance,
    expectedMove,
    expectedMovePct: spot > 0 ? (expectedMove / spot) * 100 : 0,
    netGEX,
    gammaFlip,
    atmIV: (atmRow.callIV + atmRow.putIV) / 2,
  };
}

export function buildupLabel(b: Buildup): string {
  switch (b) {
    case 'LONG_BUILDUP':
      return 'Long buildup';
    case 'SHORT_BUILDUP':
      return 'Short buildup';
    case 'SHORT_COVERING':
      return 'Short covering';
    case 'LONG_UNWINDING':
      return 'Long unwinding';
    default:
      return '—';
  }
}
