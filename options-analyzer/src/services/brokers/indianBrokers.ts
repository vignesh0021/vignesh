import SHA256 from 'crypto-js/sha256';

import type { BrokerId, BrokerPosition } from './types';

/**
 * Additional Indian broker connectors (read-only, positions monitoring).
 *
 * ⚠ BETA: these are coded to each broker's published API but are NOT yet
 * verified on a live account from this environment — endpoints/field names may
 * need a small correction, which the on-screen error surfaces. Fyers remains
 * the fully-verified provider (its own module). Doc links are on each adapter.
 *
 * Auth kinds:
 *  - paste_token : broker gives a ready access token (no OAuth) — e.g. Dhan.
 *  - oauth_paste : open the broker login in a browser, paste the code/
 *                  request_token from the redirect (like the Fyers fallback).
 *  - key_totp    : direct login with API key + client + PIN + TOTP — Angel One.
 */

export type ExtraBrokerId = Exclude<BrokerId, 'fyers'>;
export type AuthKind = 'paste_token' | 'oauth_paste' | 'key_totp';

export interface BrokerField {
  key: string;
  label: string;
  secure?: boolean;
  placeholder?: string;
}

export interface BrokerMeta {
  id: ExtraBrokerId;
  name: string;
  authKind: AuthKind;
  hasChain: boolean;
  fields: BrokerField[];
  /** For oauth_paste: the login URL to open, and what to paste back. */
  loginUrl?: (creds: Record<string, string>) => string;
  captureLabel?: string;
  note: string;
}

const TIMEOUT_MS = 12000;

async function req(url: string, init?: RequestInit): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
    });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export const EXTRA_BROKERS: BrokerMeta[] = [
  {
    id: 'dhan',
    name: 'Dhan',
    authKind: 'paste_token',
    hasChain: true,
    fields: [
      { key: 'clientId', label: 'Client ID', placeholder: 'e.g. 1000000001' },
      { key: 'accessToken', label: 'Access Token', secure: true, placeholder: 'from web.dhan.co → DhanHQ APIs' },
    ],
    captureLabel: '',
    note: 'Generate an access token at web.dhan.co → Profile → DhanHQ Trading APIs. No OAuth needed.',
  },
  {
    id: 'upstox',
    name: 'Upstox',
    authKind: 'oauth_paste',
    hasChain: true,
    fields: [
      { key: 'apiKey', label: 'API Key', placeholder: 'app api key' },
      { key: 'apiSecret', label: 'API Secret', secure: true },
      { key: 'redirectUri', label: 'Redirect URI', placeholder: 'https://127.0.0.1/' },
    ],
    loginUrl: (c) =>
      `https://api.upstox.com/v2/login/authorization/dialog?response_type=code&client_id=${encodeURIComponent(c.apiKey)}&redirect_uri=${encodeURIComponent(c.redirectUri || 'https://127.0.0.1/')}`,
    captureLabel: 'Paste redirect URL (contains code=…)',
    note: 'Create an app in the Upstox developer console; set the redirect URI to match.',
  },
  {
    id: 'zerodha',
    name: 'Zerodha Kite',
    authKind: 'oauth_paste',
    hasChain: false,
    fields: [
      { key: 'apiKey', label: 'API Key', placeholder: 'kite api key' },
      { key: 'apiSecret', label: 'API Secret', secure: true },
    ],
    loginUrl: (c) => `https://kite.zerodha.com/connect/login?v=3&api_key=${encodeURIComponent(c.apiKey)}`,
    captureLabel: 'Paste redirect URL (contains request_token=…)',
    note: 'Kite Connect is a paid API (₹2000/mo). No option-chain endpoint — positions only.',
  },
  {
    id: 'angel',
    name: 'Angel One',
    authKind: 'key_totp',
    hasChain: false,
    fields: [
      { key: 'apiKey', label: 'API Key (SmartAPI)', placeholder: 'smartapi key' },
      { key: 'clientId', label: 'Client Code' },
      { key: 'pin', label: 'PIN', secure: true },
      { key: 'totp', label: 'TOTP (now)', placeholder: '6-digit from authenticator' },
    ],
    note: 'Create a SmartAPI app; the TOTP is the current 6-digit code from your authenticator.',
  },
];

export function brokerMeta(id: ExtraBrokerId): BrokerMeta {
  return EXTRA_BROKERS.find((b) => b.id === id)!;
}

/** Pull code/request_token out of a pasted redirect URL (or bare value). */
export function parseRedirectParam(input: string, param: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const m = raw.match(new RegExp(`[?&]${param}=([^&#\\s]+)`, 'i'));
  if (m) return decodeURIComponent(m[1]);
  if (/^https?:\/\//i.test(raw)) return null;
  return raw;
}

/**
 * Connect a broker: validate creds and obtain a session token. `pasted` is the
 * redirect URL / code for oauth_paste brokers. Returns the access token to
 * persist. Throws with a readable message on failure.
 */
export async function connectBroker(
  id: ExtraBrokerId,
  creds: Record<string, string>,
  pasted?: string,
): Promise<string> {
  switch (id) {
    case 'dhan': {
      // Static token — verify by hitting the profile/funds endpoint.
      // Docs: https://dhanhq.co/docs/v2/
      const token = creds.accessToken;
      if (!token) throw new Error('Enter your Dhan access token.');
      const j = await req('https://api.dhan.co/v2/fundlimit', {
        headers: { 'access-token': token, 'client-id': creds.clientId ?? '' },
      });
      if (j?.errorType || j?.status === 'failed') throw new Error(j?.errorMessage || 'Dhan token rejected.');
      return token;
    }
    case 'upstox': {
      // Docs: https://upstox.com/developer/api-documentation/
      const code = parseRedirectParam(pasted ?? '', 'code');
      if (!code) throw new Error('Paste the redirect URL containing code=…');
      const body = new URLSearchParams({
        code,
        client_id: creds.apiKey,
        client_secret: creds.apiSecret,
        redirect_uri: creds.redirectUri || 'https://127.0.0.1/',
        grant_type: 'authorization_code',
      });
      const j = await req('https://api.upstox.com/v2/login/authorization/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      if (!j?.access_token) throw new Error(j?.message || j?.errors?.[0]?.message || 'Upstox token exchange failed.');
      return j.access_token;
    }
    case 'zerodha': {
      // Docs: https://kite.trade/docs/connect/v3/
      const rt = parseRedirectParam(pasted ?? '', 'request_token');
      if (!rt) throw new Error('Paste the redirect URL containing request_token=…');
      const checksum = SHA256(`${creds.apiKey}${rt}${creds.apiSecret}`).toString();
      const body = new URLSearchParams({ api_key: creds.apiKey, request_token: rt, checksum });
      const j = await req('https://api.kite.trade/session/token', {
        method: 'POST',
        headers: { 'X-Kite-Version': '3', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      if (j?.status !== 'success' || !j?.data?.access_token) throw new Error(j?.message || 'Kite token exchange failed.');
      return j.data.access_token;
    }
    case 'angel': {
      // Docs: https://smartapi.angelbroking.com/docs
      const j = await req('https://apiconnect.angelbroking.com/rest/auth/angelbroking/user/v1/loginByPassword', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PrivateKey': creds.apiKey,
          'X-SourceID': 'WEB',
          'X-UserType': 'USER',
          'X-ClientLocalIP': '127.0.0.1',
          'X-ClientPublicIP': '127.0.0.1',
          'X-MACAddress': '00:00:00:00:00:00',
        },
        body: JSON.stringify({ clientcode: creds.clientId, password: creds.pin, totp: creds.totp }),
      });
      const token = j?.data?.jwtToken;
      if (!token) throw new Error(j?.message || 'Angel One login failed (check PIN/TOTP).');
      return token;
    }
  }
}

/** Fetch normalised positions for a connected broker. */
export async function fetchPositions(
  id: ExtraBrokerId,
  creds: Record<string, string>,
  token: string,
): Promise<BrokerPosition[]> {
  const mapCommon = (rows: any[], pick: (r: any) => Partial<BrokerPosition>): BrokerPosition[] =>
    rows
      .map((r) => ({ broker: id, currency: 'INR', symbol: '', qty: 0, avgPrice: 0, ltp: 0, pnl: 0, ...pick(r) }))
      .filter((p) => p.qty !== 0);

  switch (id) {
    case 'dhan': {
      const j = await req('https://api.dhan.co/v2/positions', {
        headers: { 'access-token': token, 'client-id': creds.clientId ?? '' },
      });
      const rows: any[] = Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : [];
      return mapCommon(rows, (r) => ({
        symbol: String(r.tradingSymbol ?? r.securityId ?? ''),
        qty: num(r.netQty ?? r.netQuantity),
        avgPrice: num(r.costPrice ?? r.buyAvg),
        ltp: num(r.ltp ?? r.lastTradedPrice),
        pnl: num(r.unrealizedProfit ?? r.realizedProfit),
        productType: r.productType,
      }));
    }
    case 'upstox': {
      const j = await req('https://api.upstox.com/v2/portfolio/short-term-positions', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const rows: any[] = Array.isArray(j?.data) ? j.data : [];
      return mapCommon(rows, (r) => ({
        symbol: String(r.tradingsymbol ?? r.trading_symbol ?? r.instrument_token ?? ''),
        qty: num(r.quantity),
        avgPrice: num(r.average_price ?? r.buy_price),
        ltp: num(r.last_price ?? r.ltp),
        pnl: num(r.pnl ?? r.unrealised),
        productType: r.product,
      }));
    }
    case 'zerodha': {
      const j = await req('https://api.kite.trade/portfolio/positions', {
        headers: { 'X-Kite-Version': '3', Authorization: `token ${creds.apiKey}:${token}` },
      });
      const rows: any[] = Array.isArray(j?.data?.net) ? j.data.net : [];
      return mapCommon(rows, (r) => ({
        symbol: String(r.tradingsymbol ?? ''),
        qty: num(r.quantity),
        avgPrice: num(r.average_price),
        ltp: num(r.last_price),
        pnl: num(r.pnl),
        productType: r.product,
      }));
    }
    case 'angel': {
      const j = await req('https://apiconnect.angelbroking.com/rest/secure/angelbroking/order/v1/getPosition', {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-PrivateKey': creds.apiKey,
          'X-SourceID': 'WEB',
          'X-UserType': 'USER',
          'Content-Type': 'application/json',
        },
      });
      const rows: any[] = Array.isArray(j?.data) ? j.data : [];
      return mapCommon(rows, (r) => ({
        symbol: String(r.tradingsymbol ?? r.symbolname ?? ''),
        qty: num(r.netqty),
        avgPrice: num(r.netprice ?? r.avgnetprice),
        ltp: num(r.ltp),
        pnl: num(r.pnl ?? r.realised),
        productType: r.producttype,
      }));
    }
  }
}
