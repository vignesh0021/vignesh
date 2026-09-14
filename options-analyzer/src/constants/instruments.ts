export type AssetClass = 'crypto' | 'india_equity' | 'other';

/**
 * A tradable underlying. Preset chips are hard-coded; anything else is resolved
 * live from Yahoo symbol search, so the whole NSE / BSE / crypto universe is
 * reachable (RELIANCE.NS, TCS.NS, INFY.BO, BTC-USD, ETH-USD, ^NSEI, ...).
 */
export interface MarketAsset {
  /** Short display ticker (e.g. BTC, NIFTY, RELIANCE). */
  symbol: string;
  /** Yahoo Finance symbol used for quotes (e.g. BTC-USD, RELIANCE.NS, ^NSEI). */
  yahoo: string;
  label: string;
  currency: string;
  assetClass: AssetClass;
  /** Contract multiplier (units of underlying per lot). Editable per leg. */
  lotSize: number;
  /** Strike spacing; 0 means "derive from live price" for searched symbols. */
  strikeStep: number;
  vixLabel: string;
}

/** Pick a sensible strike spacing for an arbitrary price level. */
export function niceStrikeStep(price: number): number {
  const p = Math.abs(price);
  if (p >= 40000) return 500;
  if (p >= 15000) return 100;
  if (p >= 5000) return 50;
  if (p >= 1000) return 20;
  if (p >= 200) return 5;
  if (p >= 50) return 1;
  return 0.5;
}

/** Classify a Yahoo symbol / quote type into an asset class. */
export function classifySymbol(symbol: string, quoteType?: string): AssetClass {
  const s = symbol.toUpperCase();
  if (quoteType === 'CRYPTOCURRENCY' || s.endsWith('-USD') || s.endsWith('-USDT')) return 'crypto';
  if (s.endsWith('.NS') || s.endsWith('.BO') || s === '^NSEI' || s === '^NSEBANK' || s === '^BSESN')
    return 'india_equity';
  return 'other';
}

/** Default lot size / vol label by class (fallback for searched symbols). */
export function defaultsForClass(cls: AssetClass): { lotSize: number; vixLabel: string; currency: string } {
  switch (cls) {
    case 'crypto':
      return { lotSize: 0.01, vixLabel: 'DVOL', currency: 'USD' };
    case 'india_equity':
      return { lotSize: 1, vixLabel: 'India VIX', currency: 'INR' };
    default:
      return { lotSize: 1, vixLabel: 'Vol', currency: 'USD' };
  }
}

/** Build an asset from a Yahoo search hit. */
export function makeAsset(symbol: string, name: string, quoteType?: string, currency?: string): MarketAsset {
  const cls = classifySymbol(symbol, quoteType);
  const d = defaultsForClass(cls);
  const display = symbol.replace(/-USD$|-USDT$|\.NS$|\.BO$/i, '').replace(/^\^/, '');
  return {
    symbol: display,
    yahoo: symbol,
    label: name || display,
    currency: currency || d.currency,
    assetClass: cls,
    lotSize: d.lotSize,
    strikeStep: 0, // derive from live price
    vixLabel: d.vixLabel,
  };
}

/**
 * Quick-select presets — NSE/BSE indices + liquid F&O stocks only (this build
 * targets the Indian market via Fyers). Any other NSE/BSE symbol is still
 * reachable through search. Lot sizes are current-ish defaults and remain
 * editable per order.
 */
export const PRESET_ASSETS: MarketAsset[] = [
  // Indices
  { symbol: 'NIFTY', yahoo: '^NSEI', label: 'Nifty 50', currency: 'INR', assetClass: 'india_equity', lotSize: 75, strikeStep: 50, vixLabel: 'India VIX' },
  { symbol: 'BANKNIFTY', yahoo: '^NSEBANK', label: 'Bank Nifty', currency: 'INR', assetClass: 'india_equity', lotSize: 35, strikeStep: 100, vixLabel: 'India VIX' },
  { symbol: 'FINNIFTY', yahoo: 'NIFTY_FIN_SERVICE.NS', label: 'Fin Nifty', currency: 'INR', assetClass: 'india_equity', lotSize: 65, strikeStep: 50, vixLabel: 'India VIX' },
  { symbol: 'SENSEX', yahoo: '^BSESN', label: 'BSE Sensex', currency: 'INR', assetClass: 'india_equity', lotSize: 20, strikeStep: 100, vixLabel: 'India VIX' },
  // Liquid F&O stocks
  { symbol: 'RELIANCE', yahoo: 'RELIANCE.NS', label: 'Reliance', currency: 'INR', assetClass: 'india_equity', lotSize: 500, strikeStep: 0, vixLabel: 'India VIX' },
  { symbol: 'HDFCBANK', yahoo: 'HDFCBANK.NS', label: 'HDFC Bank', currency: 'INR', assetClass: 'india_equity', lotSize: 550, strikeStep: 0, vixLabel: 'India VIX' },
  { symbol: 'ICICIBANK', yahoo: 'ICICIBANK.NS', label: 'ICICI Bank', currency: 'INR', assetClass: 'india_equity', lotSize: 700, strikeStep: 0, vixLabel: 'India VIX' },
  { symbol: 'SBIN', yahoo: 'SBIN.NS', label: 'SBI', currency: 'INR', assetClass: 'india_equity', lotSize: 750, strikeStep: 0, vixLabel: 'India VIX' },
  { symbol: 'INFY', yahoo: 'INFY.NS', label: 'Infosys', currency: 'INR', assetClass: 'india_equity', lotSize: 400, strikeStep: 0, vixLabel: 'India VIX' },
  { symbol: 'TCS', yahoo: 'TCS.NS', label: 'TCS', currency: 'INR', assetClass: 'india_equity', lotSize: 175, strikeStep: 0, vixLabel: 'India VIX' },
];

/** Fallback IV (decimal) if the volatility index can't be fetched. */
export function fallbackIvForClass(cls: AssetClass): number {
  switch (cls) {
    case 'crypto':
      return 0.55;
    case 'india_equity':
      return 0.14;
    default:
      return 0.3;
  }
}
