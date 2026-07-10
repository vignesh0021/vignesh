import SHA256 from 'crypto-js/sha256';

import type { BrokerPosition } from './types';

/**
 * Fyers API v3 connector (read-only). Auth is OAuth2:
 *   1. open generate-authcode in a browser → redirect returns ?auth_code=...
 *   2. exchange the auth_code for an access_token using appIdHash = SHA256(appId:secret)
 *   3. call data APIs with header  Authorization: <appId>:<access_token>
 * Docs: https://myapi.fyers.in/docsv3
 */

const AUTH = 'https://api-t1.fyers.in/api/v3';
const DATA = 'https://api-t1.fyers.in';

const TIMEOUT_MS = 12000;

async function req(url: string, init?: RequestInit): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    const json = await res.json();
    return json;
  } finally {
    clearTimeout(timer);
  }
}

/** Step 1 — the login URL the user opens in a browser. */
export function buildAuthUrl(appId: string, redirectUri: string, state = 'tlh'): string {
  const q = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
  });
  return `${AUTH}/generate-authcode?${q.toString()}`;
}

/**
 * Extract the auth_code from whatever the user pastes back after login — either
 * the full redirected URL (`https://…?auth_code=XXX&state=…`) or the bare code.
 */
export function parseAuthCode(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  // Try to pull auth_code / code out of a URL or query string.
  const m = raw.match(/[?&](?:auth_code|code)=([^&#\s]+)/i);
  if (m) return decodeURIComponent(m[1]);
  // Otherwise treat the whole thing as the code, unless it's clearly a URL.
  if (/^https?:\/\//i.test(raw)) return null;
  return raw;
}

/** Step 2 — exchange the returned auth_code for an access token. */
export async function exchangeCode(
  appId: string,
  secret: string,
  authCode: string,
): Promise<{ accessToken: string; refreshToken?: string }> {
  const appIdHash = SHA256(`${appId}:${secret}`).toString();
  const json = await req(`${AUTH}/validate-authcode`, {
    method: 'POST',
    body: JSON.stringify({ grant_type: 'authorization_code', appIdHash, code: authCode }),
  });
  if (json?.s !== 'ok' || !json?.access_token) {
    throw new Error(json?.message || 'Fyers token exchange failed');
  }
  return { accessToken: json.access_token, refreshToken: json.refresh_token };
}

function authHeader(appId: string, accessToken: string): Record<string, string> {
  return { Authorization: `${appId}:${accessToken}` };
}

/** Step 3 — net positions, normalised. */
export async function getPositions(appId: string, accessToken: string): Promise<BrokerPosition[]> {
  const json = await req(`${AUTH}/positions`, { headers: authHeader(appId, accessToken) });
  if (json?.s !== 'ok') throw new Error(json?.message || 'Fyers positions failed');
  const rows: any[] = Array.isArray(json?.netPositions) ? json.netPositions : [];
  return rows
    .filter((r) => Number(r?.netQty) !== 0)
    .map((r) => ({
      broker: 'fyers' as const,
      symbol: String(r?.symbol ?? ''),
      qty: Number(r?.netQty ?? 0),
      avgPrice: Number(r?.avgPrice ?? r?.netAvg ?? 0),
      ltp: Number(r?.ltp ?? 0),
      pnl: Number(r?.pl ?? r?.unrealized_pl ?? 0),
      currency: 'INR',
      productType: r?.productType,
    }));
}

export interface FyersExpiry {
  /** ISO yyyy-mm-dd derived from the expiry epoch. */
  iso: string;
  /** Epoch (seconds) used as the `timestamp` param to pick this expiry. */
  epoch: string;
  /** Human label as returned by Fyers (e.g. "25-07-2024"). */
  label: string;
}

export interface FyersChainQuote {
  symbol: string;
  strike: number;
  optType: 'CE' | 'PE';
  ltp: number;
  chg: number; // absolute change vs previous close
  oi: number; // open interest (contracts)
}

export interface FyersOptionChain {
  underlyingLtp: number;
  expiries: FyersExpiry[];
  rows: { strike: number; call?: FyersChainQuote; put?: FyersChainQuote }[];
}

function epochToIso(epoch: number): string {
  return new Date(epoch * 1000).toISOString().slice(0, 10);
}

/**
 * Live option chain from Fyers API v3 (`/data/options-chain-v3`). Returns the
 * expiry list, the underlying LTP, and call/put quotes grouped by strike.
 * Pass `timestamp` (an expiry epoch from a prior call) to select an expiry.
 * Docs: https://myapi.fyers.in/docsv3#tag/Data-Api/Option-Chain
 */
export async function getOptionChain(
  appId: string,
  accessToken: string,
  symbol: string,
  strikeCount = 12,
  timestamp?: string,
): Promise<FyersOptionChain> {
  // Fyers expects the timestamp param present (empty = nearest expiry).
  const q = new URLSearchParams({ symbol, strikecount: String(strikeCount), timestamp: timestamp ?? '' });
  const json = await req(`${DATA}/data/options-chain-v3?${q.toString()}`, {
    headers: authHeader(appId, accessToken),
  });
  if (json?.s !== 'ok' && json?.code !== 200) {
    // Surface the real broker reason (e.g. missing "Quotes & Market data" permission, invalid token).
    throw new Error(json?.message || json?.s || `Fyers option chain failed (${symbol})`);
  }
  const d = json?.data ?? {};
  const expiries: FyersExpiry[] = (Array.isArray(d.expiryData) ? d.expiryData : []).map((e: any) => {
    const epoch = Number(e?.expiry ?? e?.date);
    return { iso: epochToIso(epoch), epoch: String(e?.expiry ?? ''), label: String(e?.date ?? '') };
  });

  const chain: any[] = Array.isArray(d.optionsChain) ? d.optionsChain : [];
  let underlyingLtp = 0; // set from the underlying row (blank option_type) below
  const byStrike = new Map<number, { strike: number; call?: FyersChainQuote; put?: FyersChainQuote }>();
  for (const it of chain) {
    const ot = it?.option_type;
    if (ot !== 'CE' && ot !== 'PE') {
      // The underlying itself is included with a blank option_type.
      const lp = Number(it?.ltp);
      if (lp > 0) underlyingLtp = lp;
      continue;
    }
    const strike = Number(it?.strike_price);
    if (!(strike > 0)) continue;
    const quote: FyersChainQuote = {
      symbol: String(it?.symbol ?? ''),
      strike,
      optType: ot,
      ltp: Number(it?.ltp) || 0,
      chg: Number(it?.ltpch) || 0,
      oi: Number(it?.oi) || 0,
    };
    const row = byStrike.get(strike) ?? { strike };
    if (ot === 'CE') row.call = quote;
    else row.put = quote;
    byStrike.set(strike, row);
  }
  const rows = [...byStrike.values()].sort((a, b) => a.strike - b.strike);
  return { underlyingLtp, expiries, rows };
}

/** Optional: live quotes for a set of Fyers symbols (e.g. "NSE:SBIN-EQ"). */
export async function getQuotes(
  appId: string,
  accessToken: string,
  symbols: string[],
): Promise<Record<string, number>> {
  if (symbols.length === 0) return {};
  const json = await req(`${DATA}/data/quotes?symbols=${encodeURIComponent(symbols.join(','))}`, {
    headers: authHeader(appId, accessToken),
  });
  const out: Record<string, number> = {};
  const arr: any[] = Array.isArray(json?.d) ? json.d : [];
  for (const item of arr) {
    const sym = item?.n ?? item?.v?.symbol;
    const lp = Number(item?.v?.lp);
    if (sym && lp > 0) out[sym] = lp;
  }
  return out;
}
