import type { MarketAsset } from '../constants/instruments';
import type { OptionType } from '../types';

/**
 * Option contract helpers — expiries, human labels and broker symbols used by
 * the option chain and the paper-trading engine.
 */

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Weekly expiry weekday by asset class (Thu for NSE indices, Fri for crypto). */
function expiryWeekday(asset: MarketAsset): number {
  return asset.assetClass === 'india_equity' ? 4 /* Thu */ : 5 /* Fri */;
}

/** ISO (yyyy-mm-dd) for the next `count` weekly expiries on the asset's weekday. */
export function upcomingExpiries(asset: MarketAsset, count = 6): string[] {
  const weekday = expiryWeekday(asset);
  const out: string[] = [];
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  // advance to the next occurrence of `weekday` (today counts if it matches).
  let delta = (weekday - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + delta);
  for (let i = 0; i < count; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 7);
  }
  return out;
}

/** Compact expiry label like "10JUL" (matches the Market Pulse header style). */
export function expiryLabel(iso: string): string {
  const d = new Date(iso);
  const day = String(d.getDate()).padStart(2, '0');
  return `${day}${MONTHS[d.getMonth()]}`;
}

/** Short expiry tag "10 Jul". */
export function expiryTag(iso: string): string {
  const d = new Date(iso);
  const mon = MONTHS[d.getMonth()];
  return `${d.getDate()} ${mon.charAt(0)}${mon.slice(1).toLowerCase()}`;
}

export function optTypeShort(type: OptionType): 'CE' | 'PE' {
  return type === 'CALL' ? 'CE' : 'PE';
}

/** Human display symbol e.g. "BANKNIFTY 25JUL 48000 CE". */
export function displayOptionSymbol(underlying: string, expiryIso: string, strike: number, type: OptionType): string {
  return `${underlying} ${expiryLabel(expiryIso)} ${strike} ${optTypeShort(type)}`;
}

/** Best-effort Fyers option symbol e.g. "NSE:BANKNIFTY25JUL48000CE" (for live socket). */
export function fyersOptionSymbol(underlying: string, expiryIso: string, strike: number, type: OptionType): string {
  const d = new Date(expiryIso);
  const yy = String(d.getFullYear()).slice(2);
  const tag = `${yy}${MONTHS[d.getMonth()]}${String(d.getDate()).padStart(2, '0')}`;
  return `NSE:${underlying}${tag}${strike}${optTypeShort(type)}`;
}

/** Best-effort Fyers index/underlying symbol for the spot feed. */
export function fyersUnderlyingSymbol(asset: MarketAsset): string {
  const map: Record<string, string> = {
    NIFTY: 'NSE:NIFTY50-INDEX',
    BANKNIFTY: 'NSE:NIFTYBANK-INDEX',
    SENSEX: 'BSE:SENSEX-INDEX',
  };
  if (map[asset.symbol]) return map[asset.symbol];
  if (asset.assetClass === 'india_equity') return `NSE:${asset.symbol}-EQ`;
  return asset.symbol;
}

/** Stable internal key for a specific option contract. */
export function optionKey(underlying: string, expiryIso: string, strike: number, type: OptionType): string {
  return `${underlying}|${expiryIso}|${strike}|${type}`;
}
