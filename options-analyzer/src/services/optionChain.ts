import { bsGreeks, bsPrice } from '../hooks/useBlackScholes';
import type { Greeks, OptionType } from '../types';
import { daysBetween, todayIso } from '../utils/format';
import { displayOptionSymbol, fyersOptionSymbol, optionKey } from '../utils/options';

/**
 * Option-chain synthesis for the Market-Pulse-style one-screen chain.
 *
 * Every quote is derived from the live underlying spot via Black-Scholes, so
 * calls, puts and all downstream paper P&L stay mutually consistent as spot
 * ticks. Open interest is deterministic pseudo-data (stable per strike) so the
 * OI columns don't flicker on every tick. When a broker option-chain endpoint
 * is wired in later it can populate the same row shape.
 */

export interface ChainQuote {
  key: string;
  symbol: string;
  fyersSymbol: string;
  type: OptionType;
  ltp: number;
  /** Change vs the session reference spot (green/red in the UI). */
  chg: number;
  /** Open interest in lakhs (matches the Market Pulse "OI(Lacs)" column). */
  oiLacs: number;
  greeks: Greeks;
  itm: boolean;
}

export interface ChainRow {
  strike: number;
  atm: boolean;
  call: ChainQuote;
  put: ChainQuote;
}

export interface ChainParams {
  underlying: string;
  spot: number;
  /** Session reference spot used to compute the day's change. */
  refSpot: number;
  iv: number; // decimal
  rate: number;
  expiryIso: string;
  step: number;
  /** Number of strikes on each side of ATM. */
  strikesEachSide: number;
}

/** Deterministic [0,1) hash so OI is stable for a given strike. */
function hash01(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export function atmStrikeFor(spot: number, step: number): number {
  if (step <= 0) return spot;
  return Math.round(spot / step) * step;
}

function timeYearsFor(expiryIso: string): number {
  const days = daysBetween(todayIso(), expiryIso);
  return Math.max(days, 0.25) / 365; // floor so 0-DTE still has a little time value
}

function quoteFor(
  p: ChainParams,
  strike: number,
  type: OptionType,
  timeYears: number,
): ChainQuote {
  const bs = { spot: p.spot, strike, timeYears, rate: p.rate, iv: p.iv, type };
  const ltp = bsPrice(bs);
  const ref = bsPrice({ ...bs, spot: p.refSpot });
  const greeks = bsGreeks(bs);
  const itm = type === 'CALL' ? p.spot > strike : p.spot < strike;

  // Bell-ish OI peaking near ATM with a deterministic per-strike wobble.
  const dist = p.step > 0 ? Math.abs(strike - atmStrikeFor(p.spot, p.step)) / p.step : 0;
  const bell = Math.exp(-(dist * dist) / 18);
  const oiLacs = Math.max(0.02, (2 + 28 * bell) * (0.5 + hash01(strike + (type === 'CALL' ? 1 : 2))));

  return {
    key: optionKey(p.underlying, p.expiryIso, strike, type),
    symbol: displayOptionSymbol(p.underlying, p.expiryIso, strike, type),
    fyersSymbol: fyersOptionSymbol(p.underlying, p.expiryIso, strike, type),
    type,
    ltp: Math.max(ltp, 0.05),
    chg: ltp - ref,
    oiLacs,
    greeks,
    itm,
  };
}

/** Build the full chain around ATM. */
export function buildChain(p: ChainParams): { rows: ChainRow[]; atm: number } {
  const atm = atmStrikeFor(p.spot, p.step);
  const timeYears = timeYearsFor(p.expiryIso);
  const rows: ChainRow[] = [];
  for (let i = -p.strikesEachSide; i <= p.strikesEachSide; i++) {
    const strike = atm + i * p.step;
    if (strike <= 0) continue;
    rows.push({
      strike,
      atm: strike === atm,
      call: quoteFor(p, strike, 'CALL', timeYears),
      put: quoteFor(p, strike, 'PUT', timeYears),
    });
  }
  return { rows, atm };
}

/** Reprice a single contract at the current spot (used for live position MTM). */
export function priceContract(
  spot: number,
  strike: number,
  type: OptionType,
  expiryIso: string,
  iv: number,
  rate: number,
): number {
  const ltp = bsPrice({ spot, strike, timeYears: timeYearsFor(expiryIso), rate, iv, type });
  return Math.max(ltp, 0.05);
}
