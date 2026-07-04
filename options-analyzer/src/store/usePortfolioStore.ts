import { create } from 'zustand';

import type { OptionPosition } from '../types';
import { addDaysIso, todayIso } from '../utils/format';
import { realizedPnlFor } from '../utils/payoff';

/**
 * Module 2 — unified portfolio store.
 *
 * State is partitioned into `openPositions` (live market exposure) and
 * `closedPositions` (frozen realized PNL, zero Greeks). Simulation controls
 * (spot / date / IV) are kept in the same store as isolated slices so the UI
 * can subscribe narrowly and avoid cascading re-renders.
 */

let idCounter = 0;
const genId = () => `pos_${Date.now().toString(36)}_${idCounter++}`;

export type NewPositionInput = Omit<OptionPosition, 'id' | 'status' | 'realizedPnl' | 'exitPremium'>;

interface PortfolioState {
  openPositions: OptionPosition[];
  closedPositions: OptionPosition[];

  // Market / simulation slice
  instrument: string;
  spotPrice: number; // live spot
  targetSpot: number; // slider-controlled simulated spot
  rate: number; // risk-free rate (decimal)
  ivShift: number; // global IV shift (decimal, e.g. -0.05 = -5%)
  targetDate: string; // simulated "now" for T+0 curve

  // Actions
  addPosition: (input: NewPositionInput) => void;
  updatePosition: (id: string, patch: Partial<OptionPosition>) => void;
  removePosition: (id: string) => void;
  closePosition: (id: string, exitPremium: number) => void;
  reopenPosition: (id: string) => void;
  clearAll: () => void;

  setSpotPrice: (v: number) => void;
  setTargetSpot: (v: number) => void;
  setRate: (v: number) => void;
  setIvShift: (v: number) => void;
  setTargetDate: (iso: string) => void;
  resetTargetSpot: () => void;
  resetTargetDate: () => void;
  setInstrument: (v: string) => void;
}

// Seed matching the reference screenshots: short call + two short puts on BTC.
const SEED_EXPIRY = addDaysIso(todayIso(), 55); // ~28 Aug style horizon
const SEED_SPOT = 62847;

const seedOpen: OptionPosition[] = [
  {
    id: genId(),
    instrument: 'BTC',
    type: 'CALL',
    action: 'SELL',
    strike: 68000,
    expiry: SEED_EXPIRY,
    entryPremium: 890,
    lots: 1,
    lotSize: 0.1,
    iv: 0.55,
    status: 'OPEN',
  },
  {
    id: genId(),
    instrument: 'BTC',
    type: 'PUT',
    action: 'SELL',
    strike: 49000,
    expiry: SEED_EXPIRY,
    entryPremium: 783.5,
    lots: 1,
    lotSize: 0.2,
    iv: 0.62,
    status: 'OPEN',
  },
  {
    id: genId(),
    instrument: 'BTC',
    type: 'PUT',
    action: 'SELL',
    strike: 55000,
    expiry: SEED_EXPIRY,
    entryPremium: 1154.9,
    lots: 1,
    lotSize: 0.1,
    iv: 0.6,
    status: 'OPEN',
  },
];

export const usePortfolioStore = create<PortfolioState>((set) => ({
  openPositions: seedOpen,
  closedPositions: [],

  instrument: 'BTC',
  spotPrice: SEED_SPOT,
  targetSpot: SEED_SPOT,
  rate: 0.05,
  ivShift: 0,
  targetDate: todayIso(),

  addPosition: (input) =>
    set((s) => ({
      openPositions: [
        ...s.openPositions,
        { ...input, id: genId(), status: 'OPEN' },
      ],
    })),

  updatePosition: (id, patch) =>
    set((s) => ({
      openPositions: s.openPositions.map((p) =>
        p.id === id ? { ...p, ...patch } : p,
      ),
      closedPositions: s.closedPositions.map((p) =>
        p.id === id ? { ...p, ...patch } : p,
      ),
    })),

  removePosition: (id) =>
    set((s) => ({
      openPositions: s.openPositions.filter((p) => p.id !== id),
      closedPositions: s.closedPositions.filter((p) => p.id !== id),
    })),

  // Closing freezes realized PNL and drops the leg's Greeks to 0 by moving it
  // out of `openPositions` (aggregate Greeks only ever scan open legs).
  closePosition: (id, exitPremium) =>
    set((s) => {
      const pos = s.openPositions.find((p) => p.id === id);
      if (!pos) return {};
      const closed: OptionPosition = {
        ...pos,
        status: 'CLOSED',
        exitPremium,
        realizedPnl: realizedPnlFor(pos, exitPremium),
      };
      return {
        openPositions: s.openPositions.filter((p) => p.id !== id),
        closedPositions: [...s.closedPositions, closed],
      };
    }),

  reopenPosition: (id) =>
    set((s) => {
      const pos = s.closedPositions.find((p) => p.id === id);
      if (!pos) return {};
      const reopened: OptionPosition = {
        ...pos,
        status: 'OPEN',
        exitPremium: undefined,
        realizedPnl: undefined,
      };
      return {
        closedPositions: s.closedPositions.filter((p) => p.id !== id),
        openPositions: [...s.openPositions, reopened],
      };
    }),

  clearAll: () => set({ openPositions: [], closedPositions: [] }),

  setSpotPrice: (v) => set({ spotPrice: v }),
  setTargetSpot: (v) => set({ targetSpot: v }),
  setRate: (v) => set({ rate: v }),
  setIvShift: (v) => set({ ivShift: v }),
  setTargetDate: (iso) => set({ targetDate: iso }),
  resetTargetSpot: () => set((s) => ({ targetSpot: s.spotPrice })),
  resetTargetDate: () => set({ targetDate: todayIso() }),
  setInstrument: (v) => set({ instrument: v }),
}));
