import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { priceContract } from '../services/optionChain';
import type { OptionAction, OptionPosition, OptionType } from '../types';

/**
 * Paper-trading engine. Places, fills and manages virtual orders against the
 * live (or simulated) tape so a user can rehearse real option trades with real
 * P&L mechanics but zero money at risk.
 *
 * Accounting mirrors a real broker:
 *  - realizedPnl accumulates from closed quantity (net of estimated charges)
 *  - each open position marks-to-market from the live spot every tick
 *  - equity      = startingFunds + realizedPnl + unrealised MTM
 *  - usedMargin  = premium debit for longs, SPAN-style block for shorts
 *  - available   = startingFunds + realizedPnl − usedMargin
 */

export type PaperOrderType = 'MARKET' | 'LIMIT';
export type PaperOrderStatus = 'PENDING' | 'FILLED' | 'CANCELLED' | 'REJECTED';
export type ProductType = 'MIS' | 'NRML';

export interface Contract {
  key: string;
  symbol: string;
  underlying: string;
  strike: number;
  optType: OptionType;
  expiryIso: string;
  lotSize: number;
  iv: number;
  rate: number;
}

export interface PaperOrder extends Contract {
  id: string;
  action: OptionAction;
  orderType: PaperOrderType;
  product: ProductType;
  lots: number;
  limitPrice?: number;
  status: PaperOrderStatus;
  avgFillPrice?: number;
  reason?: string;
  placedAt: number;
  updatedAt: number;
}

export interface PaperPosition extends Contract {
  id: string;
  action: OptionAction; // BUY = long, SELL = short
  product: ProductType;
  lots: number; // net (> 0)
  avgPrice: number;
  ltp: number;
  /** Timestamp of the last real (broker) LTP applied — while fresh, the BS tape won't overwrite it. */
  ltpLiveAt?: number;
  openedAt: number;
}

/** How long a broker LTP is trusted before the synthetic tape takes over again. */
const LIVE_LTP_TTL_MS = 20000;

export interface PaperTrade {
  id: string;
  symbol: string;
  action: OptionAction;
  lots: number;
  lotSize: number;
  price: number;
  kind: 'ENTRY' | 'EXIT';
  realized?: number;
  at: number;
}

export interface OrderRequest extends Contract {
  action: OptionAction;
  orderType: PaperOrderType;
  product: ProductType;
  lots: number;
  limitPrice?: number;
}

let seq = 0;
const genId = (p: string) => `${p}_${Date.now().toString(36)}_${seq++}`;

const DEFAULT_FUNDS = 1_000_000; // ₹10 lakh virtual capital
const SHORT_MARGIN_RATE = 0.12; // SPAN-ish block on short notional

/** Directional multiplier: BUY long = +1, SELL short = −1. */
function sign(action: OptionAction): number {
  return action === 'BUY' ? 1 : -1;
}

/** Estimated round-trip-ish charges for a single fill (brokerage + taxes). */
function chargesFor(turnover: number, action: OptionAction, enabled: boolean): number {
  if (!enabled) return 0;
  const brokerage = 20; // flat per order
  const txn = turnover * 0.0005; // exchange + gst + stt approximation
  const stt = action === 'SELL' ? turnover * 0.000625 : 0; // STT on sell premium
  return brokerage + txn + stt;
}

export function positionPnl(pos: PaperPosition): number {
  return sign(pos.action) * (pos.ltp - pos.avgPrice) * pos.lots * pos.lotSize;
}

/** Map live paper positions into analyzer OptionPositions so the payoff/greeks reflect them. */
export function paperToOptionPositions(positions: PaperPosition[]): OptionPosition[] {
  return positions.map((p) => ({
    id: p.id,
    instrument: p.underlying,
    type: p.optType,
    action: p.action,
    strike: p.strike,
    expiry: p.expiryIso,
    entryPremium: p.avgPrice,
    lots: p.lots,
    lotSize: p.lotSize,
    iv: p.iv,
    status: 'OPEN',
    markPrice: p.ltp,
  }));
}

export function positionMargin(pos: PaperPosition): number {
  if (pos.action === 'BUY') return pos.avgPrice * pos.lots * pos.lotSize; // premium debit
  return pos.strike * pos.lots * pos.lotSize * SHORT_MARGIN_RATE; // short block
}

export interface PaperSummary {
  realized: number;
  unrealized: number;
  equity: number;
  usedMargin: number;
  available: number;
  dayPnl: number;
}

export function summarize(s: PaperState): PaperSummary {
  const unrealized = s.positions.reduce((a, p) => a + positionPnl(p), 0);
  const usedMargin = s.positions.reduce((a, p) => a + positionMargin(p), 0);
  const equity = s.startingFunds + s.realizedPnl + unrealized;
  return {
    realized: s.realizedPnl,
    unrealized,
    equity,
    usedMargin,
    available: s.startingFunds + s.realizedPnl - usedMargin,
    dayPnl: s.realizedPnl + unrealized,
  };
}

interface PaperState {
  enabled: boolean;
  startingFunds: number;
  chargesEnabled: boolean;
  realizedPnl: number;

  positions: PaperPosition[];
  orders: PaperOrder[];
  trades: PaperTrade[];

  setEnabled: (b: boolean) => void;
  setStartingFunds: (n: number) => void;
  setChargesEnabled: (b: boolean) => void;

  /** Place an order at the given current option LTP (for market / marketable). */
  placeOrder: (req: OrderRequest, ltp: number) => { ok: boolean; reason?: string };
  cancelOrder: (id: string) => void;
  squareOff: (positionId: string) => void;
  squareOffAll: () => void;
  /** Reprice positions and try to fill pending limit orders from a fresh spot. */
  onSpot: (spot: number) => void;
  /** Apply real broker LTPs (keyed by option symbol) to positions + pending limit orders. */
  applyLtps: (ltps: Record<string, number>) => void;
  resetPaper: () => void;
}

export const usePaperStore = create<PaperState>()(
  persist(
    (set, get) => {
      /** Apply a fill to positions & realized P&L; append trade rows. */
      function applyFill(o: {
        contract: Contract;
        action: OptionAction;
        product: ProductType;
        lots: number;
        price: number;
      }) {
        const { contract, action, product, lots, price } = o;
        const state = get();
        const positions = [...state.positions];
        const trades = [...state.trades];
        let realizedDelta = 0;
        let remaining = lots;

        const idx = positions.findIndex((p) => p.key === contract.key && p.product === product);
        const existing = idx >= 0 ? positions[idx] : null;

        if (existing && existing.action !== action) {
          // Opposite side — reduce / close / flip.
          const closeLots = Math.min(remaining, existing.lots);
          const realized =
            sign(existing.action) * (price - existing.avgPrice) * closeLots * existing.lotSize;
          realizedDelta += realized;
          realizedDelta -= chargesFor(price * closeLots * existing.lotSize, action, state.chargesEnabled);
          trades.push({
            id: genId('trd'),
            symbol: contract.symbol,
            action,
            lots: closeLots,
            lotSize: contract.lotSize,
            price,
            kind: 'EXIT',
            realized,
            at: Date.now(),
          });
          remaining -= closeLots;
          const leftInPos = existing.lots - closeLots;
          if (leftInPos > 0) {
            positions[idx] = { ...existing, lots: leftInPos };
          } else {
            positions.splice(idx, 1);
          }
        }

        if (remaining > 0) {
          // Open or add on the order's side.
          realizedDelta -= chargesFor(price * remaining * contract.lotSize, action, state.chargesEnabled);
          trades.push({
            id: genId('trd'),
            symbol: contract.symbol,
            action,
            lots: remaining,
            lotSize: contract.lotSize,
            price,
            kind: 'ENTRY',
            at: Date.now(),
          });
          const same = positions.findIndex(
            (p) => p.key === contract.key && p.product === product && p.action === action,
          );
          if (same >= 0) {
            const p = positions[same];
            const totalLots = p.lots + remaining;
            positions[same] = {
              ...p,
              avgPrice: (p.avgPrice * p.lots + price * remaining) / totalLots,
              lots: totalLots,
              ltp: price,
            };
          } else {
            positions.push({
              ...contract,
              id: genId('pos'),
              action,
              product,
              lots: remaining,
              avgPrice: price,
              ltp: price,
              openedAt: Date.now(),
            });
          }
        }

        set({ positions, trades, realizedPnl: state.realizedPnl + realizedDelta });
      }

      return {
        enabled: true,
        startingFunds: DEFAULT_FUNDS,
        chargesEnabled: true,
        realizedPnl: 0,
        positions: [],
        orders: [],
        trades: [],

        setEnabled: (b) => set({ enabled: b }),
        setStartingFunds: (n) => set({ startingFunds: Math.max(0, n) }),
        setChargesEnabled: (b) => set({ chargesEnabled: b }),

        placeOrder: (req, ltp) => {
          if (req.lots <= 0) return { ok: false, reason: 'Lots must be at least 1' };
          const marketable =
            req.orderType === 'MARKET' ||
            (req.action === 'BUY' && req.limitPrice != null && ltp <= req.limitPrice) ||
            (req.action === 'SELL' && req.limitPrice != null && ltp >= req.limitPrice);
          const fillPrice = req.orderType === 'MARKET' ? ltp : req.limitPrice ?? ltp;

          const base: PaperOrder = {
            ...req,
            id: genId('ord'),
            status: 'PENDING',
            placedAt: Date.now(),
            updatedAt: Date.now(),
          };

          if (marketable) {
            applyFill({
              contract: req,
              action: req.action,
              product: req.product,
              lots: req.lots,
              price: fillPrice,
            });
            set((s) => ({
              orders: [
                { ...base, status: 'FILLED', avgFillPrice: fillPrice, updatedAt: Date.now() },
                ...s.orders,
              ],
            }));
          } else {
            set((s) => ({ orders: [base, ...s.orders] }));
          }
          return { ok: true };
        },

        cancelOrder: (id) =>
          set((s) => ({
            orders: s.orders.map((o) =>
              o.id === id && o.status === 'PENDING'
                ? { ...o, status: 'CANCELLED', updatedAt: Date.now() }
                : o,
            ),
          })),

        squareOff: (positionId) => {
          const pos = get().positions.find((p) => p.id === positionId);
          if (!pos) return;
          applyFill({
            contract: pos,
            action: pos.action === 'BUY' ? 'SELL' : 'BUY',
            product: pos.product,
            lots: pos.lots,
            price: pos.ltp,
          });
        },

        squareOffAll: () => {
          for (const pos of [...get().positions]) {
            applyFill({
              contract: pos,
              action: pos.action === 'BUY' ? 'SELL' : 'BUY',
              product: pos.product,
              lots: pos.lots,
              price: pos.ltp,
            });
          }
        },

        onSpot: (spot) => {
          if (spot <= 0) return;
          const s = get();
          const hasPending = s.orders.some((o) => o.status === 'PENDING');
          if (s.positions.length === 0 && !hasPending) return;

          const now = Date.now();
          const reprice = (p: PaperPosition): PaperPosition => {
            // Don't let the synthetic tape overwrite a fresh real broker LTP.
            if (p.ltpLiveAt && now - p.ltpLiveAt < LIVE_LTP_TTL_MS) return p;
            return { ...p, ltp: priceContract(spot, p.strike, p.optType, p.expiryIso, p.iv, p.rate) };
          };

          // 1. Mark open positions to the live spot.
          if (s.positions.length > 0) set({ positions: s.positions.map(reprice) });

          // 2. Fill any pending limit orders that have become marketable.
          if (!hasPending) return;
          const filledAt: Record<string, number> = {};
          for (const o of get().orders) {
            if (o.status !== 'PENDING' || o.limitPrice == null) continue;
            const optLtp = priceContract(spot, o.strike, o.optType, o.expiryIso, o.iv, o.rate);
            const hit =
              (o.action === 'BUY' && optLtp <= o.limitPrice) ||
              (o.action === 'SELL' && optLtp >= o.limitPrice);
            if (hit) {
              applyFill({ contract: o, action: o.action, product: o.product, lots: o.lots, price: o.limitPrice });
              filledAt[o.id] = o.limitPrice;
            }
          }
          if (Object.keys(filledAt).length > 0) {
            set((st) => ({
              orders: st.orders.map((o) =>
                filledAt[o.id] != null
                  ? { ...o, status: 'FILLED', avgFillPrice: filledAt[o.id], updatedAt: Date.now() }
                  : o,
              ),
              positions: st.positions.map(reprice),
            }));
          }
        },

        applyLtps: (ltps) => {
          const s = get();
          const now = Date.now();

          // Mark positions to their real broker LTP.
          let posChanged = false;
          const positions = s.positions.map((p) => {
            const lp = ltps[p.symbol];
            if (lp != null && lp > 0) {
              posChanged = true;
              return { ...p, ltp: lp, ltpLiveAt: now };
            }
            return p;
          });
          if (posChanged) set({ positions });

          // Fill pending limit orders that the real LTP now satisfies.
          if (!s.orders.some((o) => o.status === 'PENDING')) return;
          const filledAt: Record<string, number> = {};
          for (const o of get().orders) {
            if (o.status !== 'PENDING' || o.limitPrice == null) continue;
            const lp = ltps[o.symbol];
            if (!(lp > 0)) continue;
            const hit =
              (o.action === 'BUY' && lp <= o.limitPrice) || (o.action === 'SELL' && lp >= o.limitPrice);
            if (hit) {
              applyFill({ contract: o, action: o.action, product: o.product, lots: o.lots, price: o.limitPrice });
              filledAt[o.id] = o.limitPrice;
            }
          }
          if (Object.keys(filledAt).length > 0) {
            set((st) => ({
              orders: st.orders.map((o) =>
                filledAt[o.id] != null
                  ? { ...o, status: 'FILLED', avgFillPrice: filledAt[o.id], updatedAt: Date.now() }
                  : o,
              ),
            }));
          }
        },

        resetPaper: () => set({ positions: [], orders: [], trades: [], realizedPnl: 0 }),
      };
    },
    {
      name: 'tlh-paper-v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        enabled: s.enabled,
        startingFunds: s.startingFunds,
        chargesEnabled: s.chargesEnabled,
        realizedPnl: s.realizedPnl,
        positions: s.positions,
        orders: s.orders,
        trades: s.trades,
      }),
    },
  ),
);
