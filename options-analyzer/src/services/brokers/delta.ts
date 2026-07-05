import HmacSHA256 from 'crypto-js/hmac-sha256';
import Hex from 'crypto-js/enc-hex';

import type { BrokerPosition } from './types';

/**
 * Delta Exchange India connector (read-only). Private endpoints are
 * HMAC-SHA256 signed:  signature = HMAC(secret, method + timestamp + path + query + body).
 * Headers: api-key, timestamp (unix seconds), signature.
 * Docs: https://docs.delta.exchange
 */

const BASE = 'https://api.india.delta.exchange';
const TIMEOUT_MS = 12000;

function sign(secret: string, message: string): string {
  return HmacSHA256(message, secret).toString(Hex);
}

async function signedGet(path: string, apiKey: string, apiSecret: string): Promise<any> {
  const ts = Math.floor(Date.now() / 1000).toString();
  const signature = sign(apiSecret, 'GET' + ts + path);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(BASE + path, {
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        'api-key': apiKey,
        timestamp: ts,
        signature,
        'User-Agent': 'tradelikehunter',
      },
    });
    const json = await res.json();
    if (json?.success === false) {
      throw new Error(json?.error?.code || 'Delta request failed');
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

async function publicMark(symbol: string): Promise<number> {
  try {
    const res = await fetch(`${BASE}/v2/tickers/${encodeURIComponent(symbol)}`);
    const json = await res.json();
    const r = json?.result ?? json;
    return Number(r?.mark_price ?? r?.close ?? r?.spot_price ?? 0);
  } catch {
    return 0;
  }
}

/** Read the account's open positions, enriched with a live mark & PnL. */
export async function getPositions(apiKey: string, apiSecret: string): Promise<BrokerPosition[]> {
  const json = await signedGet('/v2/positions/margined', apiKey, apiSecret);
  const rows: any[] = Array.isArray(json?.result) ? json.result : [];
  const open = rows.filter((r) => Number(r?.size) !== 0);

  const marks = await Promise.all(
    open.map((r) => publicMark(String(r?.product_symbol ?? r?.product?.symbol ?? ''))),
  );

  return open.map((r, i) => {
    const size = Number(r?.size ?? 0);
    const entry = Number(r?.entry_price ?? 0);
    const ltp = marks[i] || Number(r?.mark_price ?? 0);
    const reported = r?.unrealized_pnl ?? r?.unrealised_pnl;
    const pnl = reported != null ? Number(reported) : (ltp > 0 ? (ltp - entry) * size : 0);
    return {
      broker: 'delta' as const,
      symbol: String(r?.product_symbol ?? r?.product?.symbol ?? ''),
      qty: size,
      avgPrice: entry,
      ltp,
      pnl,
      currency: 'USD',
      productType: r?.product?.contract_type,
    };
  });
}

/** Sanity-check credentials by hitting a private endpoint. */
export async function verify(apiKey: string, apiSecret: string): Promise<boolean> {
  await signedGet('/v2/wallet/balances', apiKey, apiSecret);
  return true;
}
