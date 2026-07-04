import { create } from 'zustand';

import {
  PRESET_ASSETS,
  fallbackIvForClass,
  niceStrikeStep,
  type MarketAsset,
} from '../constants/instruments';
import { fetchSpotForAsset, fetchVolForAsset } from '../services/marketData';
import type { OptionPosition } from '../types';
import { addDaysIso, todayIso } from '../utils/format';
import { realizedPnlFor } from '../utils/payoff';

/**
 * Module 2 — unified portfolio + market store.
 *
 * Positions are partitioned into `openPositions` (live exposure) and
 * `closedPositions` (frozen realized PNL, zero Greeks). The active `asset`
 * (any preset or searched NSE/BSE/crypto symbol) plus simulation controls and
 * live quote state live here as narrow slices.
 */

let idCounter = 0;
const genId = () => `pos_${Date.now().toString(36)}_${idCounter++}`;

export type NewPositionInput = Omit<
  OptionPosition,
  'id' | 'status' | 'realizedPnl' | 'exitPremium'
>;

function withRealized(pos: OptionPosition): OptionPosition {
  if (pos.status === 'CLOSED' && pos.exitPremium != null) {
    return { ...pos, realizedPnl: realizedPnlFor(pos, pos.exitPremium) };
  }
  return pos;
}

interface PortfolioState {
  openPositions: OptionPosition[];
  closedPositions: OptionPosition[];

  // Market / simulation slice
  asset: MarketAsset;
  spotPrice: number;
  targetSpot: number;
  rate: number;
  ivShift: number;
  targetDate: string;
  defaultIv: number; // default IV (decimal) for new legs, driven by the vol index
  vix: number | null; // last fetched volatility index (percent)

  // Live quote status
  spotSource: string | null;
  vixSource: string | null;
  marketLoading: boolean;
  marketError: string | null;
  lastFetched: number | null;

  // Position actions
  addPosition: (input: NewPositionInput) => void;
  updatePosition: (id: string, patch: Partial<OptionPosition>) => void;
  removePosition: (id: string) => void;
  closePosition: (id: string, exitPremium: number) => void;
  updateExitPremium: (id: string, exitPremium: number) => void;
  reopenPosition: (id: string) => void;
  clearAll: () => void;
  /** Replace all open legs (used when applying a predefined strategy). */
  setOpenPositions: (legs: NewPositionInput[]) => void;

  // Market actions
  selectAsset: (asset: MarketAsset) => Promise<void>;
  refreshMarket: () => Promise<void>;
  setSpotPrice: (v: number) => void;
  setDefaultIv: (v: number) => void;
  setTargetSpot: (v: number) => void;
  setRate: (v: number) => void;
  setIvShift: (v: number) => void;
  setTargetDate: (iso: string) => void;
  resetTargetSpot: () => void;
  resetTargetDate: () => void;
}

const SEED_ASSET = PRESET_ASSETS[0]; // BTC
const SEED_EXPIRY = addDaysIso(todayIso(), 55);
const SEED_SPOT = 62847;

const seedOpen: OptionPosition[] = [
  { id: genId(), instrument: 'BTC', type: 'CALL', action: 'SELL', strike: 68000, expiry: SEED_EXPIRY, entryPremium: 890, lots: 1, lotSize: 0.1, iv: 0.55, status: 'OPEN' },
  { id: genId(), instrument: 'BTC', type: 'PUT', action: 'SELL', strike: 49000, expiry: SEED_EXPIRY, entryPremium: 783.5, lots: 1, lotSize: 0.2, iv: 0.62, status: 'OPEN' },
  { id: genId(), instrument: 'BTC', type: 'PUT', action: 'SELL', strike: 55000, expiry: SEED_EXPIRY, entryPremium: 1154.9, lots: 1, lotSize: 0.1, iv: 0.6, status: 'OPEN' },
];

export const usePortfolioStore = create<PortfolioState>((set, get) => ({
  openPositions: seedOpen,
  closedPositions: [],

  asset: SEED_ASSET,
  spotPrice: SEED_SPOT,
  targetSpot: SEED_SPOT,
  rate: 0.05,
  ivShift: 0,
  targetDate: todayIso(),
  defaultIv: fallbackIvForClass(SEED_ASSET.assetClass),
  vix: null,

  spotSource: null,
  vixSource: null,
  marketLoading: false,
  marketError: null,
  lastFetched: null,

  addPosition: (input) =>
    set((s) => ({ openPositions: [...s.openPositions, { ...input, id: genId(), status: 'OPEN' }] })),

  updatePosition: (id, patch) =>
    set((s) => ({
      openPositions: s.openPositions.map((p) => (p.id === id ? withRealized({ ...p, ...patch }) : p)),
      closedPositions: s.closedPositions.map((p) => (p.id === id ? withRealized({ ...p, ...patch }) : p)),
    })),

  removePosition: (id) =>
    set((s) => ({
      openPositions: s.openPositions.filter((p) => p.id !== id),
      closedPositions: s.closedPositions.filter((p) => p.id !== id),
    })),

  closePosition: (id, exitPremium) =>
    set((s) => {
      const pos = s.openPositions.find((p) => p.id === id);
      if (!pos) return {};
      const closed: OptionPosition = { ...pos, status: 'CLOSED', exitPremium, realizedPnl: realizedPnlFor(pos, exitPremium) };
      return {
        openPositions: s.openPositions.filter((p) => p.id !== id),
        closedPositions: [...s.closedPositions, closed],
      };
    }),

  updateExitPremium: (id, exitPremium) =>
    set((s) => ({
      closedPositions: s.closedPositions.map((p) => (p.id === id ? withRealized({ ...p, exitPremium }) : p)),
    })),

  reopenPosition: (id) =>
    set((s) => {
      const pos = s.closedPositions.find((p) => p.id === id);
      if (!pos) return {};
      const reopened: OptionPosition = { ...pos, status: 'OPEN', exitPremium: undefined, realizedPnl: undefined };
      return {
        closedPositions: s.closedPositions.filter((p) => p.id !== id),
        openPositions: [...s.openPositions, reopened],
      };
    }),

  clearAll: () => set({ openPositions: [], closedPositions: [] }),

  setOpenPositions: (legs) =>
    set({ openPositions: legs.map((l) => ({ ...l, id: genId(), status: 'OPEN' })) }),

  selectAsset: async (asset) => {
    set({
      asset,
      defaultIv: fallbackIvForClass(asset.assetClass),
      marketLoading: true,
      marketError: null,
      vix: null,
      vixSource: null,
    });
    await get().refreshMarket();
  },

  refreshMarket: async () => {
    const asset = get().asset;
    set({ marketLoading: true, marketError: null });
    const [spotRes, volRes] = await Promise.allSettled([
      fetchSpotForAsset(asset),
      fetchVolForAsset(asset),
    ]);

    const patch: Partial<PortfolioState> = { marketLoading: false, lastFetched: Date.now() };
    const errors: string[] = [];

    if (spotRes.status === 'fulfilled') {
      const price = spotRes.value.value;
      patch.spotPrice = price;
      patch.targetSpot = price;
      patch.spotSource = spotRes.value.source;
      // Derive strike spacing from live price for searched (step === 0) assets.
      if (asset.strikeStep === 0) {
        patch.asset = { ...asset, strikeStep: niceStrikeStep(price) };
      }
    } else {
      errors.push('spot');
    }

    if (volRes.status === 'fulfilled' && volRes.value) {
      patch.vix = volRes.value.value;
      patch.defaultIv = volRes.value.value / 100;
      patch.vixSource = volRes.value.source;
    } else if (volRes.status === 'rejected') {
      errors.push('vol');
    }

    if (errors.length) {
      patch.marketError = `Couldn't fetch ${errors.join(' & ')} — edit manually below.`;
    }
    set(patch);
  },

  setSpotPrice: (v) => set({ spotPrice: v, targetSpot: v, spotSource: 'manual' }),
  setDefaultIv: (v) => set({ defaultIv: v, vix: v * 100, vixSource: 'manual' }),
  setTargetSpot: (v) => set({ targetSpot: v }),
  setRate: (v) => set({ rate: v }),
  setIvShift: (v) => set({ ivShift: v }),
  setTargetDate: (iso) => set({ targetDate: iso }),
  resetTargetSpot: () => set((s) => ({ targetSpot: s.spotPrice })),
  resetTargetDate: () => set({ targetDate: todayIso() }),
}));
