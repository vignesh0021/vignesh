import { makeAsset, type MarketAsset } from '../constants/instruments';

/**
 * Live market data from free, key-less public endpoints, fetched on-device.
 * Universe search uses Yahoo, so any NSE (.NS), BSE (.BO) or crypto (-USD)
 * symbol resolves. Every call is defensive with a timeout and fallback.
 */

const TIMEOUT_MS = 9000;

async function getJson(url: string): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (tradelikehunter)' },
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
      throw new Error('no price');
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('yahoo failed');
}

async function binanceSpot(base: string): Promise<number> {
  const json = await getJson(`https://api.binance.com/api/v3/ticker/price?symbol=${base}USDT`);
  const price = Number(json?.price);
  if (!(price > 0)) throw new Error('no price');
  return price;
}

/** Deribit DVOL — 30-day annualised implied-vol index for BTC or ETH, as %. */
async function deribitDvol(currency: 'BTC' | 'ETH'): Promise<number> {
  const end = Date.now();
  const start = end - 24 * 3600 * 1000;
  const url =
    `https://www.deribit.com/api/v2/public/get_volatility_index_data` +
    `?currency=${currency}&start_timestamp=${start}&end_timestamp=${end}&resolution=3600`;
  const json = await getJson(url);
  const data = json?.result?.data;
  if (!Array.isArray(data) || data.length === 0) throw new Error('no dvol');
  const close = Number(data[data.length - 1]?.[4]);
  if (!(close > 0)) throw new Error('bad dvol');
  return close;
}

export interface Quote {
  value: number;
  source: string;
}

/** Live spot for any asset (Binance fast-path for BTC/ETH, else Yahoo). */
export async function fetchSpotForAsset(asset: MarketAsset): Promise<Quote> {
  if (asset.assetClass === 'crypto' && (asset.symbol === 'BTC' || asset.symbol === 'ETH')) {
    try {
      return { value: await binanceSpot(asset.symbol), source: 'Binance' };
    } catch {
      /* fall through to Yahoo */
    }
  }
  return { value: await yahooPrice(asset.yahoo), source: 'Yahoo' };
}

/**
 * Volatility index for an asset as a percentage (DVOL for BTC/ETH, India VIX
 * for NSE/BSE). Returns null when no free index applies — caller keeps its
 * editable fallback IV.
 */
export async function fetchVolForAsset(asset: MarketAsset): Promise<Quote | null> {
  if (asset.assetClass === 'crypto' && (asset.symbol === 'BTC' || asset.symbol === 'ETH')) {
    return { value: await deribitDvol(asset.symbol as 'BTC' | 'ETH'), source: `Deribit DVOL` };
  }
  if (asset.assetClass === 'india_equity') {
    return { value: await yahooPrice('^INDIAVIX'), source: 'India VIX' };
  }
  return null;
}

export interface SymbolHit {
  symbol: string;
  name: string;
  exchange: string;
  quoteType: string;
}

/** Search the Yahoo universe (equities, indices, crypto, ETFs). */
export async function searchSymbols(query: string): Promise<MarketAsset[]> {
  const q = query.trim();
  if (q.length < 1) return [];
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=12&newsCount=0`;
  const json = await getJson(url);
  const quotes: any[] = Array.isArray(json?.quotes) ? json.quotes : [];
  const allowed = new Set(['EQUITY', 'CRYPTOCURRENCY', 'INDEX', 'ETF', 'CURRENCY']);
  return quotes
    .filter((qt) => qt?.symbol && allowed.has(qt?.quoteType))
    .map((qt) =>
      makeAsset(
        qt.symbol,
        qt.shortname || qt.longname || qt.symbol,
        qt.quoteType,
        qt.currency,
      ),
    );
}
