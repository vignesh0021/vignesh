import type { FyersCandle } from './brokers/fyers';
import {
  buildContracts,
  marketGate,
  positionSize,
  type BuyerSignal,
  type MarketGate,
  type ScannerContract,
} from './buyerSignals';
import type { ChainRow } from './optionChain';

/**
 * Pure price-action + options-data option-buying scanner.
 *
 * Deliberately uses NO lagging/leading technical indicators (no EMA, RSI,
 * MACD, ADX). Every signal is built from raw market data an option buyer can
 * act on:
 *   • Structure   — opening-range breakout, previous-day-high/low & 20-bar
 *                   swing breaks (break of structure), all on completed bars.
 *   • Location    — session VWAP (a volume-weighted PRICE, not an average).
 *   • Momentum    — range expansion vs recent average range, rate-of-change,
 *                   consecutive directional closes, close-location in the bar.
 *   • Options data— OI change (put-writing / call-unwinding = bullish, and the
 *                   mirror), the ATM straddle expected-move, and IV richness.
 *   • Contract    — 0.35–0.80 delta (ATM to moderately ITM, the buyer's sweet
 *                   spot); deep-ITM and deep-OTM are rejected; spread / OI /
 *                   volume liquidity gates.
 *
 * Only setups where the structure break, VWAP side, momentum expansion AND OI
 * (when available) all align — inside the tradable market window — are marked
 * ACTIVE. Everything else is WATCH or REJECTED. High bar by design.
 */

const IST_OFFSET_MIN = 330;

function istDay(t: number): string {
  return new Date((t + IST_OFFSET_MIN * 60) * 1000).toISOString().slice(0, 10);
}
function istMinutes(t: number): number {
  const d = new Date((t + IST_OFFSET_MIN * 60) * 1000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function atr(candles: FyersCandle[], period = 14): number {
  if (candles.length < 2) return 0;
  const tr: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const pc = candles[i - 1].c;
    tr.push(Math.max(c.h - c.l, Math.abs(c.h - pc), Math.abs(c.l - pc)));
  }
  const s = tr.slice(-period);
  return s.reduce((a, b) => a + b, 0) / s.length;
}

function avgRange(candles: FyersCandle[], n = 20): number {
  const s = candles.slice(-n - 1, -1);
  if (s.length === 0) return 0;
  return s.reduce((a, c) => a + (c.h - c.l), 0) / s.length;
}

/** Session VWAP for the latest IST trading day; equal-weight fallback for zero-volume index feeds. */
function sessionVwap(candles: FyersCandle[]): number {
  if (candles.length === 0) return 0;
  const day = istDay(candles[candles.length - 1].t);
  const session = candles.filter((c) => {
    const m = istMinutes(c.t);
    return istDay(c.t) === day && m >= 9 * 60 + 15 && m <= 15 * 60 + 30;
  });
  const use = session.length ? session : candles.slice(-75);
  let pv = 0;
  let vol = 0;
  for (const c of use) {
    const typ = (c.h + c.l + c.c) / 3;
    const v = c.v > 0 ? c.v : 1;
    pv += typ * v;
    vol += v;
  }
  return vol > 0 ? pv / vol : use[use.length - 1].c;
}

/** Opening range from the first 3 completed session bars (15 min). */
function openingRange(candles: FyersCandle[]): { orh: number; orl: number } | null {
  if (candles.length === 0) return null;
  const day = istDay(candles[candles.length - 1].t);
  const session = candles.filter((c) => istDay(c.t) === day && istMinutes(c.t) >= 9 * 60 + 15);
  if (session.length < 3) return null;
  const first = session.slice(0, 3);
  return { orh: Math.max(...first.map((c) => c.h)), orl: Math.min(...first.map((c) => c.l)) };
}

/** Previous IST day's high / low. */
function prevDayHL(candles: FyersCandle[]): { pdh: number; pdl: number } | null {
  if (candles.length === 0) return null;
  const today = istDay(candles[candles.length - 1].t);
  const prevDays = [...new Set(candles.map((c) => istDay(c.t)))].filter((d) => d < today).sort();
  const prev = prevDays[prevDays.length - 1];
  if (!prev) return null;
  const bars = candles.filter((c) => istDay(c.t) === prev);
  if (bars.length === 0) return null;
  return { pdh: Math.max(...bars.map((c) => c.h)), pdl: Math.min(...bars.map((c) => c.l)) };
}

function swingHL(candles: FyersCandle[], lookback = 20): { hi: number; lo: number } {
  const s = candles.slice(-lookback - 1, -1);
  if (s.length === 0) return { hi: 0, lo: 0 };
  return { hi: Math.max(...s.map((c) => c.h)), lo: Math.min(...s.map((c) => c.l)) };
}

/** Buyer contract: 0.35–0.80 delta, no deep ITM/OTM, liquid; target ~0.55. */
function selectBuyerContract(contracts: ScannerContract[], optType: 'CE' | 'PE'): ScannerContract | null {
  const band = contracts.filter(
    (c) =>
      c.optType === optType &&
      Math.abs(c.delta) >= 0.35 &&
      Math.abs(c.delta) <= 0.8 &&
      c.ltp >= 5 &&
      c.bid > 0 &&
      c.ask >= c.bid &&
      c.spreadPct <= 4,
  );
  if (band.length === 0) return null;
  const cost = (c: ScannerContract) =>
    Math.abs(Math.abs(c.delta) - 0.55) +
    c.spreadPct / 100 +
    (c.oi < 50000 ? 0.2 : 0) +
    (c.volume < 10000 ? 0.12 : 0);
  return band.reduce((best, c) => (cost(c) < cost(best) ? c : best));
}

export interface PureContext {
  vwap: number;
  orh: number | null;
  orl: number | null;
  pdh: number | null;
  pdl: number | null;
  swingHi: number;
  swingLo: number;
  atr: number;
  avgRange: number;
  lastRange: number;
  roc3Pct: number;
  lastClose: number;
  netOiBull: number; // put ΔOI − call ΔOI near ATM (positive = bullish flow)
  oiAvailable: boolean;
  expectedMove: number; // ATM straddle
  barsUsed: number;
}

export interface PureScanResult {
  signals: BuyerSignal[];
  gate: MarketGate;
  context: PureContext | null;
}

export interface PureScanInput {
  candles: FyersCandle[];
  rows: ChainRow[];
  spot: number;
  step: number;
  expiryIso: string;
  ivPct: number;
  lotSize: number;
  equity: number;
  source: 'fyers' | 'sim';
}

export function generatePureSignals(input: PureScanInput): PureScanResult {
  const gate = marketGate(input.source, input.expiryIso);
  const completed = input.candles.length > 1 ? input.candles.slice(0, -1) : input.candles;
  if (completed.length < 25 || input.rows.length === 0) {
    return { signals: [], gate, context: null };
  }

  const closes = completed.map((c) => c.c);
  const lastClose = closes[closes.length - 1];
  const bar = completed[completed.length - 1];
  const range = Math.max(bar.h - bar.l, 0.01);
  const closeLoc = (bar.c - bar.l) / range;
  const curAtr = atr(completed);
  const avgR = avgRange(completed) || curAtr || 1;
  const vwap = sessionVwap(completed);
  const or = openingRange(completed);
  const pd = prevDayHL(completed);
  const swing = swingHL(completed);
  const buffer = curAtr * 0.05;
  const roc3Pct = closes.length > 3 && closes[closes.length - 4] > 0
    ? ((lastClose - closes[closes.length - 4]) / closes[closes.length - 4]) * 100
    : 0;
  const upCloses = closes[closes.length - 1] > closes[closes.length - 2] && closes[closes.length - 2] > closes[closes.length - 3];
  const downCloses = closes[closes.length - 1] < closes[closes.length - 2] && closes[closes.length - 2] < closes[closes.length - 3];
  const rangeExpansion = range >= 1.3 * avgR;

  // ---- options-data confirmation (OI change near ATM) ---------------------
  const atmStrike = input.step > 0 ? Math.round(input.spot / input.step) * input.step : input.spot;
  const near = input.rows.filter((r) => Math.abs(r.strike - atmStrike) <= 3 * input.step);
  let callOiChg = 0;
  let putOiChg = 0;
  let oiAvailable = false;
  for (const r of near) {
    if (r.call.oiChg != null && r.call.oiChg !== 0) oiAvailable = true;
    if (r.put.oiChg != null && r.put.oiChg !== 0) oiAvailable = true;
    callOiChg += r.call.oiChg ?? 0;
    putOiChg += r.put.oiChg ?? 0;
  }
  // Bullish when puts are being written (support builds) and/or calls unwind.
  const netOiBull = putOiChg - callOiChg;
  const oiThreshold = Math.max(Math.abs(callOiChg) + Math.abs(putOiChg), 1) * 0.15;

  const atmRow = input.rows.reduce((best, r) => (Math.abs(r.strike - atmStrike) < Math.abs(best.strike - atmStrike) ? r : best));
  const expectedMove = (atmRow.call.ltp || 0) + (atmRow.put.ltp || 0);

  const contracts = buildContracts(input.rows);
  const signals: BuyerSignal[] = [];

  const build = (direction: 'BULLISH' | 'BEARISH') => {
    const optType = direction === 'BULLISH' ? 'CE' : 'PE';
    const contract = selectBuyerContract(contracts, optType);
    if (!contract) return;

    const bullish = direction === 'BULLISH';
    // Structure
    const orbBreak = or ? (bullish ? lastClose > or.orh + buffer : lastClose < or.orl - buffer) : false;
    const structRef = bullish
      ? Math.max(pd?.pdh ?? -Infinity, swing.hi)
      : Math.min(pd?.pdl ?? Infinity, swing.lo);
    const bosBreak = isFinite(structRef) ? (bullish ? lastClose > structRef + buffer : lastClose < structRef - buffer) : false;
    const structure = orbBreak || bosBreak;
    // Location + momentum (pure data)
    const vwapSide = bullish ? lastClose > vwap : lastClose < vwap;
    const dirCloses = bullish ? upCloses : downCloses;
    const dirRoc = bullish ? roc3Pct > 0.05 : roc3Pct < -0.05;
    const closeStrong = bullish ? closeLoc >= 0.62 : closeLoc <= 0.38;
    const momentum = rangeExpansion && dirRoc && dirCloses && closeStrong;
    // Options-data confirmation
    const oiConfirm = !oiAvailable ? null : bullish ? netOiBull >= oiThreshold : netOiBull <= -oiThreshold;
    const oiContradicts = oiConfirm === false;
    const liquid =
      contract.spreadPct <= 2.0 &&
      contract.oi >= 50000 &&
      contract.volume >= 10000 &&
      Math.abs(contract.delta) >= 0.35 &&
      Math.abs(contract.delta) <= 0.8;

    // Confidence from pure-data confirmations only.
    let score = 0;
    if (orbBreak) score += 30;
    if (bosBreak) score += orbBreak ? 8 : 26;
    if (vwapSide) score += 14;
    if (rangeExpansion) score += 12;
    if (dirRoc) score += 8;
    if (dirCloses) score += 6;
    if (closeStrong) score += 6;
    if (oiConfirm === true) score += 14;
    if (liquid) score += 10;
    if (oiContradicts) score -= 20;
    if (input.ivPct > 18) score -= 8;
    if (input.ivPct > 24) score -= 8;
    const confidence = Math.max(0, Math.min(98, Math.round(score)));

    // Underlying-structure stop → option SL/target via delta (data-anchored).
    const invalidationLevel = bullish ? Math.max(vwap, or?.orl ?? -Infinity, structRef - buffer) : Math.min(vwap, or?.orh ?? Infinity, structRef + buffer);
    const riskUnderlying = Math.abs(lastClose - invalidationLevel);
    const absDelta = Math.abs(contract.delta) || 0.5;
    const rr = confidence >= 82 ? 2.0 : 1.8;
    let stopLoss: number;
    let target: number;
    if (riskUnderlying > 0 && isFinite(riskUnderlying)) {
      stopLoss = Math.round(Math.max(0.05, contract.ask - absDelta * riskUnderlying) * 100) / 100;
      target = Math.round((contract.ask + absDelta * riskUnderlying * rr) * 100) / 100;
    } else {
      stopLoss = Math.round(Math.max(0.05, contract.ask * 0.75) * 100) / 100;
      target = Math.round((contract.ask + (contract.ask - stopLoss) * rr) * 100) / 100;
    }
    const sizing = positionSize(input.equity, input.lotSize, contract.ask, stopLoss);

    // Room for the option to pay before theta: needed underlying move vs expected move.
    const neededMove = riskUnderlying > 0 ? riskUnderlying * rr : ((target - contract.ask) / absDelta);
    const moveFits = expectedMove <= 0 || neededMove <= expectedMove * 0.9;

    const coreReady = structure && vwapSide && momentum && !oiContradicts && liquid;
    const active = coreReady && confidence >= 82 && gate.allowed && sizing.qty > 0 && moveFits;
    const status: BuyerSignal['status'] = active ? 'ACTIVE' : confidence >= 68 && structure ? 'WATCH' : 'REJECTED';

    const blockers: string[] = [];
    if (!structure) blockers.push('no completed-bar structure break (ORB / PDH-PDL / 20-bar)');
    if (!vwapSide) blockers.push('price on the wrong side of session VWAP');
    if (!momentum) blockers.push('no range-expansion momentum thrust');
    if (oiContradicts) blockers.push('OI change contradicts the direction');
    if (!liquid) blockers.push('strike liquidity / delta-band gate failed');
    if (!moveFits) blockers.push('target beyond the day’s expected move (theta risk)');
    if (!gate.allowed) blockers.push(gate.reason);
    if (sizing.qty <= 0) blockers.push('risk / premium cap allows no lot');

    const reasons = [
      structure
        ? `Structure: ${orbBreak ? 'opening-range breakout' : ''}${orbBreak && bosBreak ? ' + ' : ''}${bosBreak ? 'break of PDH/PDL/20-bar' : ''} beyond ${(bullish ? Math.min(or?.orh ?? Infinity, structRef) : Math.max(or?.orl ?? -Infinity, structRef)).toFixed(0)} (+ATR buffer)`
        : 'Structure: waiting for a completed-bar break.',
      `VWAP: price ${vwapSide ? (bullish ? 'above' : 'below') : 'not aligned with'} session VWAP ${vwap.toFixed(0)}.`,
      `Momentum: range ${rangeExpansion ? '≥1.3×' : '<1.3×'} avg, ROC3 ${roc3Pct >= 0 ? '+' : ''}${roc3Pct.toFixed(2)}%, close ${closeStrong ? 'strong' : 'weak'} in bar.`,
      oiAvailable
        ? `Options data: net ΔOI ${netOiBull >= 0 ? '+' : ''}${(netOiBull / 1000).toFixed(0)}k near ATM → ${oiConfirm ? 'confirms' : 'does not confirm'} ${bullish ? 'put-writing/call-unwind (bullish)' : 'call-writing/put-unwind (bearish)'}.`
        : 'Options data: ΔOI unavailable on this feed — direction rests on price action only.',
      `Expected move (ATM straddle) ≈ ${expectedMove.toFixed(0)}; setup needs ≈ ${neededMove.toFixed(0)} ${moveFits ? '(fits)' : '(too far)'}.`,
      `Contract: ${contract.optType} Δ ${Math.abs(contract.delta).toFixed(2)} (0.35–0.80 buyer band), spread ${contract.spreadPct.toFixed(2)}%, OI ${(contract.oi / 1e5).toFixed(1)}L.`,
    ];

    signals.push({
      id: `${contract.symbol}-PURE-${direction}`,
      title: bullish ? 'CE Buy · Break + Momentum' : 'PE Buy · Break + Momentum',
      direction,
      status,
      confidence,
      contract,
      entry: contract.ask,
      stopLoss,
      target,
      riskReward: rr,
      suggestedLots: sizing.lots,
      suggestedQty: sizing.qty,
      maxRiskInr: sizing.maxRiskInr,
      holdingMinutes: 30,
      reasons,
      invalidation: bullish
        ? `Underlying closes back below ${invalidationLevel.toFixed(0)} (VWAP / breakout base).`
        : `Underlying closes back above ${invalidationLevel.toFixed(0)} (VWAP / breakdown base).`,
      blockers,
    });
  };

  build('BULLISH');
  build('BEARISH');

  return {
    signals: signals.filter((s) => s.confidence > 0).sort((a, b) => b.confidence - a.confidence),
    gate,
    context: {
      vwap,
      orh: or?.orh ?? null,
      orl: or?.orl ?? null,
      pdh: pd?.pdh ?? null,
      pdl: pd?.pdl ?? null,
      swingHi: swing.hi,
      swingLo: swing.lo,
      atr: curAtr,
      avgRange: avgR,
      lastRange: range,
      roc3Pct,
      lastClose,
      netOiBull,
      oiAvailable,
      expectedMove,
      barsUsed: completed.length,
    },
  };
}
