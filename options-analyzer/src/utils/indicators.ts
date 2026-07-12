import type { FyersCandle } from '../services/brokers/fyers';

/**
 * Technical indicators computed on-device from OHLCV candles. Each function
 * returns an array aligned 1:1 with the input candles; positions where the
 * indicator isn't defined yet (warm-up window) hold null so renderers can skip
 * them cleanly.
 */

export type Series = (number | null)[];

export function sma(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder's RSI. */
export function rsi(values: number[], period = 14): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export interface MacdResult {
  macd: Series;
  signal: Series;
  histogram: Series;
}

export function macd(values: number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  const fastE = ema(values, fast);
  const slowE = ema(values, slow);
  const line: Series = values.map((_, i) =>
    fastE[i] != null && slowE[i] != null ? (fastE[i] as number) - (slowE[i] as number) : null,
  );
  // Signal = EMA of the MACD line over its defined region.
  const defined = line.map((v, i) => ({ v, i })).filter((x) => x.v != null);
  const signal: Series = new Array(values.length).fill(null);
  if (defined.length >= signalPeriod) {
    const seg = ema(defined.map((x) => x.v as number), signalPeriod);
    defined.forEach((x, j) => {
      signal[x.i] = seg[j];
    });
  }
  const histogram: Series = line.map((v, i) =>
    v != null && signal[i] != null ? v - (signal[i] as number) : null,
  );
  return { macd: line, signal, histogram };
}

export interface BollingerResult {
  upper: Series;
  middle: Series;
  lower: Series;
}

export function bollinger(values: number[], period = 20, mult = 2): BollingerResult {
  const middle = sma(values, period);
  const upper: Series = new Array(values.length).fill(null);
  const lower: Series = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const m = middle[i] as number;
    let sq = 0;
    for (let j = i - period + 1; j <= i; j++) sq += (values[j] - m) ** 2;
    const sd = Math.sqrt(sq / period);
    upper[i] = m + mult * sd;
    lower[i] = m - mult * sd;
  }
  return { upper, middle, lower };
}

/**
 * VWAP, reset at each new trading day. Indices often report zero volume — in
 * that case each bar weighs equally (falls back to a cumulative typical-price
 * average), which still tracks the session's fair value.
 */
export function vwap(candles: FyersCandle[]): Series {
  const out: Series = new Array(candles.length).fill(null);
  let day = '';
  let cumPV = 0;
  let cumV = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const d = new Date(c.t * 1000).toISOString().slice(0, 10);
    if (d !== day) {
      day = d;
      cumPV = 0;
      cumV = 0;
    }
    const typical = (c.h + c.l + c.c) / 3;
    const vol = c.v > 0 ? c.v : 1;
    cumPV += typical * vol;
    cumV += vol;
    out[i] = cumPV / cumV;
  }
  return out;
}
