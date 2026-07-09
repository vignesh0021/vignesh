/**
 * Fyers API v3 market-data WebSocket (read-only, best-effort).
 *
 * The real Fyers v3 data socket streams a compact binary protocol. Rather than
 * ship a brittle binary parser that can't be exercised outside market hours,
 * this client speaks the documented *lite* JSON handshake and defensively
 * parses any frame that carries a recognisable `symbol` + last-price field.
 * When Fyers streams a frame we can't decode we simply ignore it — the caller
 * (LiveFeed) always keeps a synthetic tick engine running underneath, so the
 * paper-trading tape stays live whether or not the socket yields quotes.
 *
 * Auth: the same `<appId>:<accessToken>` token used by the REST connector, sent
 * both as a query param and in the first subscribe frame (Fyers accepts either
 * across SDK versions).
 *
 * Docs: https://myapi.fyers.in/docsv3#tag/Data-Socket
 */

const WS_URL = 'wss://api-t1.fyers.in/data/socket/v1';

export type FyersSocketStatus = 'connecting' | 'open' | 'closed' | 'error';

export interface FyersTick {
  symbol: string;
  ltp: number;
}

export interface FyersSocketHandle {
  /** Change the set of subscribed symbols (replaces the previous set). */
  setSymbols: (symbols: string[]) => void;
  close: () => void;
}

export interface FyersSocketOptions {
  appId: string;
  accessToken: string;
  symbols: string[];
  onTick: (tick: FyersTick) => void;
  onStatus?: (status: FyersSocketStatus, detail?: string) => void;
}

/** Pull a numeric last-traded-price out of the many shapes Fyers has shipped. */
function extractLtp(node: any): number | null {
  const candidates = [node?.ltp, node?.lp, node?.last_price, node?.v?.lp, node?.c];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function extractSymbol(node: any): string | null {
  const s = node?.symbol ?? node?.n ?? node?.v?.symbol ?? node?.ts;
  return typeof s === 'string' && s.length > 0 ? s : null;
}

/**
 * Open a Fyers data socket. Returns a handle immediately; ticks and status
 * updates arrive via callbacks. Safe to call in React Native (global WebSocket).
 */
export function openFyersDataSocket(opts: FyersSocketOptions): FyersSocketHandle {
  const token = `${opts.appId}:${opts.accessToken}`;
  let symbols = [...opts.symbols];
  let ws: WebSocket | null = null;
  let closedByUser = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const status = (s: FyersSocketStatus, detail?: string) => opts.onStatus?.(s, detail);

  const sendSubscribe = () => {
    if (!ws || ws.readyState !== 1 /* OPEN */) return;
    // Lite JSON subscribe frame accepted by Fyers v3 data socket.
    const frame = {
      T: 'SUB_L2',
      L2LIST: symbols,
      SLIST: symbols,
      symbols,
      subs: 1,
      mode: 'ltp',
      token,
    };
    try {
      ws.send(JSON.stringify(frame));
    } catch {
      /* ignore send failures — reconnect loop will recover */
    }
  };

  const handleMessage = (raw: any) => {
    if (typeof raw !== 'string') return; // binary frames are not decoded here
    let json: any;
    try {
      json = JSON.parse(raw);
    } catch {
      return;
    }
    // Frames may be a single quote, an array, or { d: [...] } / { data: [...] }.
    const rows: any[] = Array.isArray(json)
      ? json
      : Array.isArray(json?.d)
        ? json.d
        : Array.isArray(json?.data)
          ? json.data
          : [json];
    for (const row of rows) {
      const symbol = extractSymbol(row);
      const ltp = extractLtp(row);
      if (symbol && ltp != null) opts.onTick({ symbol, ltp });
    }
  };

  const connect = () => {
    if (closedByUser) return;
    status('connecting');
    try {
      ws = new WebSocket(`${WS_URL}?access_token=${encodeURIComponent(token)}`);
    } catch (e) {
      status('error', (e as Error).message);
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      status('open');
      sendSubscribe();
    };
    ws.onmessage = (ev: WebSocketMessageEvent) => handleMessage(ev.data);
    ws.onerror = (ev: any) => status('error', ev?.message);
    ws.onclose = () => {
      status('closed');
      if (!closedByUser) scheduleReconnect();
    };
  };

  const scheduleReconnect = () => {
    if (closedByUser || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 4000);
  };

  connect();

  return {
    setSymbols: (next) => {
      symbols = [...next];
      sendSubscribe();
    },
    close: () => {
      closedByUser = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        ws?.close();
      } catch {
        /* noop */
      }
    },
  };
}
