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
