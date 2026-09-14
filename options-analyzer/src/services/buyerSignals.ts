import type { FyersCandle } from './brokers/fyers';
import type { ChainQuote, ChainRow } from './optionChain';

/**
 * Nifty Option Buyer signal engine — a faithful TypeScript port of the user's
 * desktop project (nifty-options-buyer: app/strategies/signals.py +
 * indicators.py + risk.py). Three setups on completed 5-minute bars:
 *
 *   1. Trend Breakout CE Buy  — bullish EMA stack + 20-bar-high breakout
 *   2. Breakdown PE Buy       — bearish EMA stack + 20-bar-low breakdown
 *   3. VWAP Reclaim / Rejection — fresh completed-bar VWAP cross
 *
 * Weighted checks build a confidence score (penalised for high IV / theta),
 * contract selection targets |delta| ≈ 0.42 with spread/liquidity gates, and
 * position sizing enforces 0.75% risk / 12% premium caps like the original.
 * Only completed bars are used — never the forming candle.
 */

// ---------------------------------------------------------------------------
// Indicators — ported exactly from app/strategies/indicators.py
// ---------------------------------------------------------------------------

function emaSeries(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const alpha = 2 / (period + 1);
  const out = [values[0]];
  for (let i = 1; i < values.length; i++) out.push(values[i] * alpha + out[i - 1] * (1 - alpha));
  return out;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** Simple-mean RSI (the desktop project's variant, not Wilder smoothing). */
function rsiSimple(values: number[], period = 14): number {
  if (values.length <= period) return 50;
  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const ch = values[i] - values[i - 1];
    gains.push(Math.max(ch, 0));
    losses.push(Math.abs(Math.min(ch, 0)));
  }
  const avgGain = mean(gains.slice(-period));
  const avgLoss = mean(losses.slice(-period));
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function atr(candles: FyersCandle[], period = 14): number {
  if (candles.length < 2) return 0;
  const ranges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = candles[i - 1].c;
    ranges.push(Math.max(c.h - c.l, Math.abs(c.h - prevClose), Math.abs(c.l - prevClose)));
  }
  return mean(ranges.slice(-period));
}

function adx(candles: FyersCandle[], period = 14): number {
  if (candles.length < period * 2 + 1) return 0;
  const tr: number[] = [];
  const plusDm: number[] = [];
  const minusDm: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i];
    const prev = candles[i - 1];
    const up = cur.h - prev.h;
    const down = prev.l - cur.l;
    plusDm.push(up > down && up > 0 ? up : 0);
    minusDm.push(down > up && down > 0 ? down : 0);
    tr.push(Math.max(cur.h - cur.l, Math.abs(cur.h - prev.c), Math.abs(cur.l - prev.c)));
  }
  let sTr = tr.slice(0, period).reduce((a, b) => a + b, 0);
  let sPlus = plusDm.slice(0, period).reduce((a, b) => a + b, 0);
  let sMinus = minusDm.slice(0, period).reduce((a, b) => a + b, 0);
  const dx: number[] = [];
  for (let i = period; i < tr.length; i++) {
    sTr = sTr - sTr / period + tr[i];
    sPlus = sPlus - sPlus / period + plusDm[i];
    sMinus = sMinus - sMinus / period + minusDm[i];
    if (sTr <= 0) continue;
    const pDi = (100 * sPlus) / sTr;
    const mDi = (100 * sMinus) / sTr;
    const den = pDi + mDi;
    if (den > 0) dx.push((100 * Math.abs(pDi - mDi)) / den);
  }
  return dx.length ? mean(dx.slice(-period)) : 0;
}

function anchoredVwap(candles: FyersCandle[]): number {
  let pv = 0;
  let vol = 0;
  for (const c of candles) {
    const typical = (c.h + c.l + c.c) / 3;
    pv += typical * c.v;
    vol += c.v;
  }
  if (vol > 0) return pv / vol;
  // Zero-volume feed (indices): equal-weight typical price.
  return candles.length ? mean(candles.map((c) => (c.h + c.l + c.c) / 3)) : 0;
}

const IST_OFFSET_MIN = 330;

/** VWAP anchored to the current IST trading session (09:15–15:30). */
function sessionVwap(candles: FyersCandle[]): number {
  if (candles.length === 0) return 0;
  const toIst = (t: number) => new Date((t + IST_OFFSET_MIN * 60) * 1000);
  const lastDay = toIst(candles[candles.length - 1].t).toISOString().slice(0, 10);
  const session = candles.filter((c) => {
    const d = toIst(c.t);
    if (d.toISOString().slice(0, 10) !== lastDay) return false;
    const hm = d.getUTCHours() * 60 + d.getUTCMinutes();
    return hm >= 9 * 60 + 15 && hm <= 15 * 60 + 30;
  });
  return anchoredVwap(session.length ? session : candles.slice(-75));
}

function relativeVolume(candles: FyersCandle[], period = 20): { value: number; available: boolean } {
  if (candles.length < 2) return { value: 0, available: false };
  const baseline = candles.slice(-period - 1, -1).map((c) => c.v).filter((v) => v > 0);
  if (baseline.length === 0) return { value: 1, available: false }; // index feed has no volume — neutral
  return { value: candles[candles.length - 1].v / Math.max(mean(baseline), 1), available: true };
}

function highestHigh(candles: FyersCandle[], lookback: number): number {
  const s = candles.slice(-lookback);
  return s.length ? Math.max(...s.map((c) => c.h)) : 0;
}

function lowestLow(candles: FyersCandle[], lookback: number): number {
  const s = candles.slice(-lookback);
  return s.length ? Math.min(...s.map((c) => c.l)) : 0;
}

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

export interface ScannerContract {
  quote: ChainQuote;
  strike: number;
  symbol: string;
  optType: 'CE' | 'PE';
  ltp: number;
  bid: number;
  ask: number;
  spreadPct: number;
  delta: number;
  theta: number;
  oi: number;
  oiChg: number;
  volume: number;
  estimated: boolean; // true when bid/ask/volume were synthesised (sim mode)
}

export function buildContracts(rows: ChainRow[]): ScannerContract[] {
  const out: ScannerContract[] = [];
  for (const row of rows) {
    for (const [q, optType] of [
      [row.call, 'CE'],
      [row.put, 'PE'],
    ] as [ChainQuote, 'CE' | 'PE'][]) {
      if (!(q.ltp > 0)) continue;
      const estimated = !(q.bid != null && q.ask != null && q.bid > 0 && q.ask > 0);
      const bid = estimated ? q.ltp * 0.995 : q.bid!;
      const ask = estimated ? q.ltp * 1.005 : q.ask!;
      const mid = Math.max((bid + ask) / 2, 0.05);
      out.push({
        quote: q,
        strike: row.strike,
        symbol: q.symbol,
        optType,
        ltp: q.ltp,
        bid,
        ask,
        spreadPct: ((ask - bid) / mid) * 100,
        delta: q.greeks.delta,
        theta: q.greeks.theta,
        oi: q.oiLacs * 1e5,
        oiChg: q.oiChg ?? 0,
        volume: q.volume != null && q.volume > 0 ? q.volume : estimated ? 15000 : 0,
        estimated,
      });
    }
  }
  return out;
}

/** Delta-targeted contract selection with the original cost function. */
function selectContract(contracts: ScannerContract[], optType: 'CE' | 'PE', targetDelta: number): ScannerContract | null {
  const candidates = contracts.filter(
    (c) =>
      c.optType === optType &&
      c.ltp >= 5 &&
      c.bid > 0 &&
      c.ask >= c.bid &&
      c.spreadPct <= 4 &&
      c.volume > 0 &&
      Math.abs(c.delta) >= 0.2 &&
      Math.abs(c.delta) <= 0.7,
  );
  if (candidates.length === 0) return null;
  const cost = (c: ScannerContract) => {
    const thetaPct = Math.abs(c.theta) / Math.max(c.ask, 0.05);
    return (
      Math.abs(c.delta - targetDelta) +
      c.spreadPct / 100 +
      thetaPct * 0.35 +
      (c.oi < 50000 ? 0.15 : 0) +
      (c.volume < 10000 ? 0.1 : 0)
    );
  };
  return candidates.reduce((best, c) => (cost(c) < cost(best) ? c : best));
}

// ---------------------------------------------------------------------------
// Market gate + sizing — ported from signals.py / risk.py / config.py
// ---------------------------------------------------------------------------

export interface MarketGate {
  allowed: boolean;
  reason: string;
  phase: string;
}

export function marketGate(source: 'fyers' | 'sim', expiryIso: string): MarketGate {
  if (source !== 'fyers') return { allowed: true, reason: 'demo mode', phase: 'DEMO' };
  const now = new Date(Date.now() + IST_OFFSET_MIN * 60000);
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return { allowed: false, reason: 'market is closed for the weekend', phase: 'CLOSED' };
  const hm = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (hm < 9 * 60 + 25) return { allowed: false, reason: 'opening-noise guard is active until 09:25', phase: 'OPENING' };
  if (hm > 15 * 60 + 10) return { allowed: false, reason: 'new option buys stop after 15:10', phase: 'LATE' };
  if (expiryIso === now.toISOString().slice(0, 10) && hm > 14 * 60 + 30) {
    return { allowed: false, reason: 'expiry-day gamma/theta guard is active after 14:30', phase: 'EXPIRY_LATE' };
  }
  return { allowed: true, reason: 'market window is tradable', phase: 'OPEN' };
}

const MAX_RISK_PER_TRADE_PCT = 0.75;
const MAX_PREMIUM_EXPOSURE_PCT = 12;

export function positionSize(equity: number, lotSize: number, ask: number, stopLoss: number) {
  const perUnitRisk = Math.max(ask - stopLoss, ask * 0.18, 0.05);
  const riskBudget = (equity * MAX_RISK_PER_TRADE_PCT) / 100;
  const riskLots = Math.max(0, Math.floor(riskBudget / (perUnitRisk * lotSize)));
  const premiumBudget = (equity * MAX_PREMIUM_EXPOSURE_PCT) / 100;
  const capitalLots = Math.max(0, Math.floor(premiumBudget / (Math.max(ask, 0.05) * lotSize)));
  const lots = Math.min(riskLots, capitalLots);
  return { lots, qty: lots * lotSize, maxRiskInr: perUnitRisk * lots * lotSize, riskBudget, premiumBudget };
}

// ---------------------------------------------------------------------------
// Signal generation
// ---------------------------------------------------------------------------

type Check = [boolean, string, number];

export interface BuyerSignal {
  id: string;
  title: string;
  direction: 'BULLISH' | 'BEARISH';
  status: 'ACTIVE' | 'WATCH' | 'REJECTED';
  confidence: number;
  contract: ScannerContract;
  entry: number;
  stopLoss: number;
  target: number;
  riskReward: number;
  suggestedLots: number;
  suggestedQty: number;
  maxRiskInr: number;
  holdingMinutes: number;
  reasons: string[];
  invalidation: string;
  blockers: string[];
}

export interface BuyerScanInput {
  candles: FyersCandle[]; // includes the forming bar — engine drops it
  rows: ChainRow[];
  spot: number;
  expiryIso: string;
  ivPct: number; // vol index (India VIX) in percent
  lotSize: number;
  equity: number;
  source: 'fyers' | 'sim';
}

export interface BuyerScanResult {
  signals: BuyerSignal[];
  gate: MarketGate;
  context: {
    ema9: number;
    ema21: number;
    ema50: number;
    rsi: number;
    adx: number;
    rvol: number;
    rvolAvailable: boolean;
    vwap: number;
    recentHigh: number;
    recentLow: number;
    lastClose: number;
    barsUsed: number;
  } | null;
}

function passedText(checks: Check[]): string {
  const p = checks.filter(([ok]) => ok).map(([, l]) => l);
  return 'Passed: ' + (p.length ? p.join(', ') : 'none');
}

function failedText(checks: Check[]): string {
  const f = checks.filter(([ok]) => !ok).map(([, l]) => l);
  return 'Missing: ' + (f.length ? f.join(', ') : 'none');
}

export function generateBuyerSignals(input: BuyerScanInput): BuyerScanResult {
  const gate = marketGate(input.source, input.expiryIso);
  // Signals only use completed bars — the last broker candle can still be forming.
  const completed = input.candles.length > 1 ? input.candles.slice(0, -1) : input.candles;
  if (completed.length < 55 || input.rows.length === 0) {
    return { signals: [], gate, context: null };
  }

  const closes = completed.map((c) => c.c);
  const lastClose = closes[closes.length - 1];
  const prevClose = closes[closes.length - 2];
  const ema9 = emaSeries(closes, 9).pop()!;
  const ema21 = emaSeries(closes, 21).pop()!;
  const ema50 = emaSeries(closes, 50).pop()!;
  const rsi = rsiSimple(closes);
  const curAtr = atr(completed);
  const curAdx = adx(completed);
  const { value: rvol, available: rvolAvailable } = relativeVolume(completed);
  const vwap = sessionVwap(completed);
  const recentHigh = highestHigh(completed.slice(0, -1), 20);
  const recentLow = lowestLow(completed.slice(0, -1), 20);
  const bar = completed[completed.length - 1];
  const range = Math.max(bar.h - bar.l, 0.01);
  const closeLocation = (bar.c - bar.l) / range;
  const breakoutBuffer = curAtr * 0.05;
  const trendUp = lastClose > ema21 && ema21 > ema50 && ema9 > ema21;
  const trendDown = lastClose < ema21 && ema21 < ema50 && ema9 < ema21;
  const breakoutUp = lastClose > recentHigh + breakoutBuffer;
  const breakoutDown = lastClose < recentLow - breakoutBuffer;

  const contracts = buildContracts(input.rows);
  const ce = selectContract(contracts, 'CE', 0.42);
  const pe = selectContract(contracts, 'PE', -0.42);
  const signals: BuyerSignal[] = [];

  const rvolNote = rvolAvailable ? null : 'Volume unavailable on the index feed — RVOL treated as neutral.';

  const build = (
    contract: ScannerContract,
    direction: 'BULLISH' | 'BEARISH',
    title: string,
    score: number,
    coreReady: boolean,
    reasons: string[],
    invalidation: string,
  ): BuyerSignal => {
    const thetaPct = (Math.abs(contract.theta) / Math.max(contract.ask, 0.05)) * 100;
    const optionReady =
      contract.bid > 0 &&
      contract.ask >= contract.bid &&
      contract.spreadPct <= 2.5 &&
      Math.abs(contract.delta) >= 0.3 &&
      Math.abs(contract.delta) <= 0.55 &&
      contract.volume >= 10000 &&
      contract.oi >= 50000 &&
      thetaPct <= 5.0;

    let penalty = 0;
    if (input.ivPct > 45) penalty += 10;
    if (thetaPct > 3.5) penalty += 8;
    const confidence = Math.max(0, Math.min(96, Math.round(score) - penalty));

    const stopFraction = confidence >= 72 ? 0.22 : 0.25;
    const stopLoss = Math.round(Math.max(0.05, contract.ask * (1 - stopFraction)) * 100) / 100;
    const risk = Math.max(contract.ask - stopLoss, 0.05);
    const targetRr = confidence >= 78 ? 1.8 : 1.6;
    const target = Math.round((contract.ask + risk * targetRr) * 100) / 100;
    const sizing = positionSize(input.equity, input.lotSize, contract.ask, stopLoss);

    const active = confidence >= 72 && coreReady && optionReady && gate.allowed && sizing.qty > 0;
    const status: BuyerSignal['status'] = active ? 'ACTIVE' : confidence >= 55 ? 'WATCH' : 'REJECTED';
    const blockers: string[] = [];
    if (!coreReady) blockers.push('price trigger is incomplete');
    if (!optionReady) blockers.push('contract quality gate failed');
    if (!gate.allowed) blockers.push(gate.reason);
    if (sizing.qty <= 0) blockers.push('risk or premium cap allows no lot');
    if (contract.estimated) blockers.push('liquidity estimated (sim/limited feed)');

    return {
      id: `${contract.symbol}-${title.replace(/ /g, '-')}`,
      title,
      direction,
      status,
      confidence,
      contract,
      entry: contract.ask,
      stopLoss,
      target,
      riskReward: targetRr,
      suggestedLots: sizing.lots,
      suggestedQty: sizing.qty,
      maxRiskInr: sizing.maxRiskInr,
      holdingMinutes: confidence >= 72 ? 35 : 20,
      reasons: reasons.filter(Boolean),
      invalidation,
      blockers,
    };
  };

  if (ce) {
    const checks: Check[] = [
      [trendUp, 'bullish EMA structure', 18],
      [breakoutUp, 'close above 20-bar high plus ATR buffer', 18],
      [lastClose > vwap, 'price above session VWAP', 12],
      [rsi >= 52 && rsi <= 70, 'RSI in controlled bullish momentum', 10],
      [curAdx >= 18, 'ADX confirms trend strength', 10],
      [rvol >= 0.9, 'completed-bar volume confirms participation', 8],
      [closeLocation >= 0.65, 'breakout candle closed near its high', 6],
      [ce.spreadPct <= 2.0, 'option spread is executable', 8],
      [Math.abs(ce.delta) >= 0.32 && Math.abs(ce.delta) <= 0.55, 'delta is in the buying zone', 6],
      [ce.volume >= 10000 && ce.oi >= 50000, 'option liquidity is adequate', 4],
    ];
    const coreReady = checks.slice(0, 7).every(([ok]) => ok);
    const score = checks.reduce((a, [ok, , w]) => a + (ok ? w : 0), 0);
    signals.push(
      build(ce, 'BULLISH', 'Trend Breakout CE Buy', score, coreReady, [
        'CE trigger requires a completed-candle breakout, not an intrabar spike.',
        rvolNote ?? '',
        passedText(checks),
        failedText(checks),
        `Close ${lastClose.toFixed(0)}; trigger ${(recentHigh + breakoutBuffer).toFixed(0)}; session VWAP ${vwap.toFixed(0)}`,
        `EMA 9/21/50 ${ema9.toFixed(0)}/${ema21.toFixed(0)}/${ema50.toFixed(0)}; RSI ${rsi.toFixed(1)}; ADX ${curAdx.toFixed(1)}; RVOL ${rvol.toFixed(2)}`,
      ], `CE thesis fails if the underlying closes below ${Math.max(vwap, ema21).toFixed(0)}.`),
    );
  }

  if (pe) {
    const checks: Check[] = [
      [trendDown, 'bearish EMA structure', 18],
      [breakoutDown, 'close below 20-bar low minus ATR buffer', 18],
      [lastClose < vwap, 'price below session VWAP', 12],
      [rsi >= 30 && rsi <= 48, 'RSI in controlled bearish momentum', 10],
      [curAdx >= 18, 'ADX confirms trend strength', 10],
      [rvol >= 0.9, 'completed-bar volume confirms participation', 8],
      [closeLocation <= 0.35, 'breakdown candle closed near its low', 6],
      [pe.spreadPct <= 2.0, 'option spread is executable', 8],
      [Math.abs(pe.delta) >= 0.32 && Math.abs(pe.delta) <= 0.55, 'delta is in the buying zone', 6],
      [pe.volume >= 10000 && pe.oi >= 50000, 'option liquidity is adequate', 4],
    ];
    const coreReady = checks.slice(0, 7).every(([ok]) => ok);
    const score = checks.reduce((a, [ok, , w]) => a + (ok ? w : 0), 0);
    signals.push(
      build(pe, 'BEARISH', 'Breakdown PE Buy', score, coreReady, [
        'PE trigger requires a completed-candle breakdown, not an intrabar spike.',
        rvolNote ?? '',
        passedText(checks),
        failedText(checks),
        `Close ${lastClose.toFixed(0)}; trigger ${(recentLow - breakoutBuffer).toFixed(0)}; session VWAP ${vwap.toFixed(0)}`,
        `EMA 9/21/50 ${ema9.toFixed(0)}/${ema21.toFixed(0)}/${ema50.toFixed(0)}; RSI ${rsi.toFixed(1)}; ADX ${curAdx.toFixed(1)}; RVOL ${rvol.toFixed(2)}`,
      ], `PE thesis fails if the underlying closes above ${Math.min(vwap, ema21).toFixed(0)}.`),
    );
  }

  // VWAP reclaim / rejection — fresh completed-bar cross setups.
  const reclaimSpecs: [ScannerContract | null, 'BULLISH' | 'BEARISH', string, boolean, boolean, boolean][] = [
    [ce, 'BULLISH', 'VWAP Reclaim CE Buy', prevClose <= vwap && vwap < lastClose, ema9 > ema21, rsi >= 50 && rsi <= 66],
    [pe, 'BEARISH', 'VWAP Rejection PE Buy', prevClose >= vwap && vwap > lastClose, ema9 < ema21, rsi >= 34 && rsi <= 50],
  ];
  for (const [contract, direction, title, freshCross, emaReady, rsiReady] of reclaimSpecs) {
    if (!contract || !freshCross) continue;
    const optionOk = contract.spreadPct <= 2.0 && contract.volume >= 10000 && contract.oi >= 50000;
    const coreReady = freshCross && emaReady && rsiReady && curAdx >= 15 && rvol >= 0.8;
    let score = 42;
    if (emaReady) score += 14;
    if (rsiReady) score += 10;
    if (curAdx >= 15) score += 10;
    if (rvol >= 0.8) score += 8;
    if (optionOk) score += 10;
    signals.push(
      build(contract, direction, title, score, coreReady, [
        `Fresh completed-bar ${direction === 'BULLISH' ? 'VWAP reclaim' : 'VWAP rejection'}.`,
        rvolNote ?? '',
        `Underlying ${lastClose.toFixed(0)}; session VWAP ${vwap.toFixed(0)}; RSI ${rsi.toFixed(1)}; ADX ${curAdx.toFixed(1)}; RVOL ${rvol.toFixed(2)}`,
      ], `Underlying closes back through session VWAP ${vwap.toFixed(0)}.`),
    );
  }

  return {
    signals: signals.sort((a, b) => b.confidence - a.confidence).slice(0, 6),
    gate,
    context: {
      ema9,
      ema21,
      ema50,
      rsi,
      adx: curAdx,
      rvol,
      rvolAvailable,
      vwap,
      recentHigh,
      recentLow,
      lastClose,
      barsUsed: completed.length,
    },
  };
}
