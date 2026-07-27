import { openFyersDataSocket, type FyersSocketHandle, type FyersSocketStatus } from './brokers/fyersSocket';

/**
 * LiveFeed — the single source of a live underlying spot price for paper
 * trading. It always runs a synthetic random-walk tick engine so the tape is
 * live 24/7 (nights, weekends, no broker connected). When a Fyers data socket
 * is attached and the market is streaming, real last-traded prices for the
 * underlying override the synthetic walk seamlessly.
 *
 * Option prices are *not* streamed leg-by-leg. Instead the whole chain and all
 * open paper positions are repriced from this one spot via Black-Scholes, which
 * keeps every quote mutually consistent tick-to-tick — exactly how a real
 * option tape behaves when the underlying moves.
 */

export type FeedSource = 'sim' | 'live';

type SpotListener = (spot: number, source: FeedSource) => void;

const TICK_MS = 1200;
const YEAR_MS = 365 * 24 * 3600 * 1000;

/** Standard normal sample (Box–Muller). */
function randn(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

class LiveFeed {
  private spot = 0;
  private base = 0;
  private vol = 0.15; // annualised vol driving the synthetic walk
  private source: FeedSource = 'sim';
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<SpotListener>();

  private fyers: FyersSocketHandle | null = null;
  private fyersSymbol: string | null = null;
  private fyersStatus: FyersSocketStatus | null = null;
  private lastLiveAt = 0;

  /** (Re)seed the walk around a reference spot without emitting. */
  setBase(spot: number, vol?: number) {
    if (spot > 0) {
      this.base = spot;
      if (this.spot <= 0) this.spot = spot;
    }
    if (vol && vol > 0) this.vol = vol;
  }

  getSpot(): number {
    return this.spot;
  }

  getSource(): FeedSource {
    return this.source;
  }

  getFyersStatus(): FyersSocketStatus | null {
    return this.fyersStatus;
  }

  subscribe(cb: SpotListener): () => void {
    this.listeners.add(cb);
    if (this.spot > 0) cb(this.spot, this.source);
    return () => this.listeners.delete(cb);
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.step(), TICK_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Attach a Fyers data socket for the given underlying Fyers symbol. */
  connectFyers(appId: string, accessToken: string, symbol: string) {
    this.disconnectFyers();
    this.fyersSymbol = symbol;
    this.fyers = openFyersDataSocket({
      appId,
      accessToken,
      symbols: [symbol],
      onTick: (t) => {
        if (t.symbol.toUpperCase().includes(this.fyersSymbol?.toUpperCase() ?? '') || t.symbol === this.fyersSymbol) {
          this.applyLive(t.ltp);
        }
      },
      onStatus: (s) => {
        this.fyersStatus = s;
      },
    });
  }

  disconnectFyers() {
    this.fyers?.close();
    this.fyers = null;
    this.fyersSymbol = null;
    this.fyersStatus = null;
    this.source = 'sim';
  }

  setFyersSymbol(symbol: string) {
    this.fyersSymbol = symbol;
    this.fyers?.setSymbols([symbol]);
  }

  private applyLive(ltp: number) {
    if (!(ltp > 0)) return;
    this.spot = ltp;
    this.base = ltp;
    this.source = 'live';
    this.lastLiveAt = Date.now();
    this.emit();
  }

  /** Push a real spot obtained out-of-band (e.g. from the REST option-chain poll). */
  pushExternalSpot(ltp: number) {
    this.applyLive(ltp);
  }

  private step() {
    // If a real quote arrived recently, let it lead and skip synthetic drift.
    if (this.source === 'live' && Date.now() - this.lastLiveAt < 6000) return;
    if (this.source === 'live') this.source = 'sim'; // live feed went quiet — resume walk

    if (this.spot <= 0) return;
    const dt = TICK_MS / YEAR_MS;
    const shock = this.vol * Math.sqrt(dt) * randn();
    // Geometric step with mild mean-reversion toward the seed so it can't drift away.
    let next = this.spot * Math.exp(shock - 0.5 * this.vol * this.vol * dt);
    if (this.base > 0) next += (this.base - next) * 0.02;
    this.spot = Math.max(next, 0.01);
    this.emit();
  }

  private emit() {
    for (const cb of this.listeners) cb(this.spot, this.source);
  }
}

/** App-wide singleton. */
export const liveFeed = new LiveFeed();
