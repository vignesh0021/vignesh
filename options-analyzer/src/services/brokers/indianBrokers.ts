import SHA256 from 'crypto-js/sha256';

import type { FyersChainQuote, FyersExpiry, FyersOptionChain } from './fyers';
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

/* ------------------------------------------------------------------ *
 * Live option chain (Upstox / Dhan) for non-Fyers users.
 *
 * Index chains only — the common case — because stock chains need an
 * instrument master (ISIN / security id per symbol) we don't ship. The
 * result is normalised to the same FyersOptionChain shape the UI already
 * renders, so the Market-Pulse chain works whichever broker is connected.
 * BETA, coded to each broker's published API; verify on a live account.
 * ------------------------------------------------------------------ */

interface UnderlyingRef {
  /** Upstox instrument_key for the index. */
  upstoxKey?: string;
  /** Dhan underlying security id + segment. */
  dhanScrip?: number;
  dhanSeg?: string;
}

/** Internal underlying symbol (as used across the app) → broker identifiers. */
const UNDERLYING_REF: Record<string, UnderlyingRef> = {
  NIFTY: { upstoxKey: 'NSE_INDEX|Nifty 50', dhanScrip: 13, dhanSeg: 'IDX_I' },
  BANKNIFTY: { upstoxKey: 'NSE_INDEX|Nifty Bank', dhanScrip: 25, dhanSeg: 'IDX_I' },
  FINNIFTY: { upstoxKey: 'NSE_INDEX|Nifty Fin Service', dhanScrip: 27, dhanSeg: 'IDX_I' },
  SENSEX: { upstoxKey: 'BSE_INDEX|SENSEX', dhanScrip: 51, dhanSeg: 'IDX_I' },
};

/** Can this broker serve a live chain for this underlying (index-only)? */
export function extraChainSupported(id: ExtraBrokerId, underlyingSymbol: string): boolean {
  const ref = UNDERLYING_REF[underlyingSymbol];
  if (!ref) return false;
  if (id === 'upstox') return !!ref.upstoxKey;
  if (id === 'dhan') return !!ref.dhanScrip;
  return false;
}

/** Trim a strike-sorted chain to ±count strikes around the ATM. */
function trimAroundAtm(
  rows: FyersOptionChain['rows'],
  spot: number,
  count: number,
): FyersOptionChain['rows'] {
  if (rows.length <= count * 2 + 1) return rows;
  let atmIdx = 0;
  let best = Infinity;
  rows.forEach((r, i) => {
    const d = Math.abs(r.strike - spot);
    if (d < best) {
      best = d;
      atmIdx = i;
    }
  });
  const lo = Math.max(0, atmIdx - count);
  return rows.slice(lo, lo + count * 2 + 1);
}

const mkQuote = (
  strike: number,
  optType: 'CE' | 'PE',
  o: { symbol?: string; ltp: number; chg: number; oi: number; bid: number; ask: number; volume: number; oiChg: number },
): FyersChainQuote => ({
  symbol: o.symbol ?? '',
  strike,
  optType,
  ltp: o.ltp,
  chg: o.chg,
  oi: o.oi,
  bid: o.bid,
  ask: o.ask,
  volume: o.volume,
  oiChg: o.oiChg,
});

/**
 * Fetch a live index option chain from Upstox or Dhan, normalised to the
 * FyersOptionChain shape. `expirySel` is an ISO date (yyyy-mm-dd) from a prior
 * call's `expiries[].epoch`; omit for the nearest expiry.
 */
export async function getExtraOptionChain(
  id: ExtraBrokerId,
  creds: Record<string, string>,
  token: string,
  underlyingSymbol: string,
  strikeCount = 12,
  expirySel?: string,
): Promise<FyersOptionChain> {
  const ref = UNDERLYING_REF[underlyingSymbol];
  if (!ref) throw new Error(`${underlyingSymbol}: live chain via this broker supports indices only.`);

  if (id === 'upstox') {
    if (!ref.upstoxKey) throw new Error(`${underlyingSymbol} not available on Upstox.`);
    const authH = { Authorization: `Bearer ${token}` };
    // Expiries from the contract list (dedupe — one row per contract).
    const cj = await req(
      `https://api.upstox.com/v2/option/contract?instrument_key=${encodeURIComponent(ref.upstoxKey)}`,
      { headers: authH },
    );
    const cRows: any[] = Array.isArray(cj?.data) ? cj.data : [];
    const isoSet = Array.from(new Set(cRows.map((r) => String(r?.expiry)).filter(Boolean))).sort();
    if (!isoSet.length) throw new Error(cj?.message || cj?.errors?.[0]?.message || 'Upstox: no expiries returned.');
    const expiries: FyersExpiry[] = isoSet.map((iso) => ({ iso, epoch: iso, label: iso }));
    const chosen = (expirySel && isoSet.includes(expirySel)) ? expirySel : isoSet[0];

    const j = await req(
      `https://api.upstox.com/v2/option/chain?instrument_key=${encodeURIComponent(ref.upstoxKey)}&expiry_date=${chosen}`,
      { headers: authH },
    );
    const data: any[] = Array.isArray(j?.data) ? j.data : [];
    if (!data.length) throw new Error(j?.message || j?.errors?.[0]?.message || 'Upstox chain empty.');
    const underlyingLtp = num(data[0]?.underlying_spot_price);
    const rows = data
      .map((d) => {
        const strike = num(d?.strike_price);
        const side = (leg: any, ot: 'CE' | 'PE') => {
          if (!leg?.market_data) return undefined;
          const m = leg.market_data;
          const ltp = num(m.ltp);
          return mkQuote(strike, ot, {
            symbol: String(leg.instrument_key ?? ''),
            ltp,
            chg: ltp - num(m.close_price),
            oi: num(m.oi),
            bid: num(m.bid_price),
            ask: num(m.ask_price),
            volume: num(m.volume),
            oiChg: num(m.oi) - num(m.prev_oi),
          });
        };
        return { strike, call: side(d?.call_options, 'CE'), put: side(d?.put_options, 'PE') };
      })
      .filter((r) => r.strike > 0)
      .sort((a, b) => a.strike - b.strike);
    return { underlyingLtp, underlyingPrevClose: 0, expiries, rows: trimAroundAtm(rows, underlyingLtp, strikeCount) };
  }

  // Dhan
  if (!ref.dhanScrip) throw new Error(`${underlyingSymbol} not available on Dhan.`);
  const dhanH = { 'access-token': token, 'client-id': creds.clientId ?? '', 'Content-Type': 'application/json' };
  const base = { UnderlyingScrip: ref.dhanScrip, UnderlyingSeg: ref.dhanSeg };
  const ej = await req('https://api.dhan.co/v2/optionchain/expirylist', {
    method: 'POST',
    headers: dhanH,
    body: JSON.stringify(base),
  });
  const isoList: string[] = Array.isArray(ej?.data) ? ej.data.map((x: any) => String(x)) : [];
  if (!isoList.length) throw new Error(ej?.errorMessage || ej?.message || 'Dhan: no expiries (check subscription).');
  const expiries: FyersExpiry[] = isoList.map((iso) => ({ iso, epoch: iso, label: iso }));
  const chosen = (expirySel && isoList.includes(expirySel)) ? expirySel : isoList[0];

  const j = await req('https://api.dhan.co/v2/optionchain', {
    method: 'POST',
    headers: dhanH,
    body: JSON.stringify({ ...base, Expiry: chosen }),
  });
  const oc = j?.data?.oc;
  if (!oc || typeof oc !== 'object') throw new Error(j?.errorMessage || j?.message || 'Dhan chain unavailable.');
  const underlyingLtp = num(j?.data?.last_price);
  const rows = Object.keys(oc)
    .map((k) => {
      const strike = num(k);
      const entry = oc[k] ?? {};
      const side = (leg: any, ot: 'CE' | 'PE') => {
        if (!leg) return undefined;
        const ltp = num(leg.last_price);
        return mkQuote(strike, ot, {
          ltp,
          chg: ltp - num(leg.previous_close_price),
          oi: num(leg.oi),
          bid: num(leg.top_bid_price),
          ask: num(leg.top_ask_price),
          volume: num(leg.volume),
          oiChg: num(leg.oi) - num(leg.previous_oi),
        });
      };
      return { strike, call: side(entry.ce, 'CE'), put: side(entry.pe, 'PE') };
    })
    .filter((r) => r.strike > 0 && (r.call || r.put))
    .sort((a, b) => a.strike - b.strike);
  return { underlyingLtp, underlyingPrevClose: 0, expiries, rows: trimAroundAtm(rows, underlyingLtp, strikeCount) };
}
