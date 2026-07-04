import { INSTRUMENTS, type InstrumentKey } from '../constants/instruments';

/**
 * Live market data from free, key-less public endpoints. All requests run
 * on-device from the phone, so there is no CORS constraint. Every call is
 * defensive: it times out, falls back where possible, and the caller always
 * has an editable manual override if a fetch returns something wrong.
 */

const TIMEOUT_MS = 9000;

async function getJson(url: string): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (options-analyzer)',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function yahooPrice(symbol: string): Promise<number> {
  const path = `v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  const hosts = ['https://query1.finance.yahoo.com/', 'https://query2.finance.yahoo.com/'];
  let lastErr: unknown;
  for (const host of hosts) {
    try {
      const json = await getJson(host + path);
      const meta = json?.chart?.result?.[0]?.meta;
      const price = meta?.regularMarketPrice ?? meta?.previousClose;
      if (typeof price === 'number' && price > 0) return price;
      throw new Error('no price in response');
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('yahoo failed');
}

async function binanceBtc(): Promise<number> {
  const json = await getJson('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
  const price = Number(json?.price);
  if (!(price > 0)) throw new Error('no price');
  return price;
}

/** Deribit DVOL — BTC 30-day annualised implied-vol index, returned as %. */
async function deribitDvol(): Promise<number> {
  const end = Date.now();
  const start = end - 24 * 3600 * 1000;
  const url =
    `https://www.deribit.com/api/v2/public/get_volatility_index_data` +
    `?currency=BTC&start_timestamp=${start}&end_timestamp=${end}&resolution=3600`;
  const json = await getJson(url);
  const data = json?.result?.data;
  if (!Array.isArray(data) || data.length === 0) throw new Error('no dvol data');
  const close = Number(data[data.length - 1]?.[4]);
  if (!(close > 0)) throw new Error('bad dvol');
  return close;
}

export interface Quote {
  value: number;
  source: string;
}

/** Live spot price for a preset instrument. */
export async function fetchSpot(key: InstrumentKey): Promise<Quote> {
  const preset = INSTRUMENTS[key];
  if (key === 'BTC') {
    try {
      return { value: await binanceBtc(), source: 'Binance' };
    } catch {
      return { value: await yahooPrice(preset.yahoo), source: 'Yahoo' };
    }
  }
  return { value: await yahooPrice(preset.yahoo), source: 'Yahoo' };
}

/**
 * Volatility index for a preset instrument, returned as a percentage number
 * (e.g. 13.5 for India VIX, 55 for BTC DVOL). Caller divides by 100 for IV.
 */
export async function fetchVix(key: InstrumentKey): Promise<Quote> {
  if (key === 'BTC') {
    return { value: await deribitDvol(), source: 'Deribit DVOL' };
  }
  return { value: await yahooPrice('^INDIAVIX'), source: 'India VIX' };
}
