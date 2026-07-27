import { impliedVol } from '../hooks/useBlackScholes';
import type { ChainRow } from './optionChain';
import { daysBetween, todayIso } from '../utils/format';

/**
 * Multi-expiry volatility surface + futures (synthetic) arbitrage — both need
 * option chains across several expiries.
 *
 * Vol surface: per-expiry ATM IV (term structure) and an IV grid over moneyness
 * offsets from ATM (the OTM wing's IV per side, standard smile convention).
 *
 * Futures arb: the synthetic future implied by put-call parity at the ATM
 * strike, F_implied = (C − P)·e^{rT} + K, compared with the fair forward
 * F_fair = S·e^{rT}. A gap beyond costs is a cash-and-carry / reverse arb.
 */

export interface ExpirySlice {
  iso: string;
  rows: ChainRow[];
}

export interface SurfaceExpiry {
  iso: string;
  dte: number;
  atmIV: number; // decimal
  atmStrike: number;
  /** IV by moneyness offset (in strike steps) from ATM, e.g. {-3..+3}. */
  cells: { offset: number; iv: number }[];
}

export interface VolSurface {
  spot: number;
  offsets: number[];
  expiries: SurfaceExpiry[];
  ivLo: number;
  ivHi: number;
}

export interface ArbRow {
  iso: string;
  dte: number;
  atmStrike: number;
  impliedForward: number;
  fairForward: number;
  basis: number; // impliedForward − spot
  basisPct: number;
  carryAnnPct: number; // annualised cost-of-carry implied
  mispricing: number; // impliedForward − fairForward
  signal: 'RICH' | 'CHEAP' | 'FAIR';
}

function atmOf(rows: ChainRow[], spot: number): ChainRow {
  return rows.reduce((b, r) => (Math.abs(r.strike - spot) < Math.abs(b.strike - spot) ? r : b));
}

export function computeVolSurface(slices: ExpirySlice[], spot: number, rate: number, halfWidth = 3): VolSurface {
  const offsets: number[] = [];
  for (let o = -halfWidth; o <= halfWidth; o++) offsets.push(o);
  let ivLo = Infinity;
  let ivHi = -Infinity;

  const expiries: SurfaceExpiry[] = slices
    .filter((s) => s.rows.length > 0)
    .map((s) => {
      const dte = Math.max(daysBetween(todayIso(), s.iso), 0.25);
      const T = dte / 365;
      const sorted = [...s.rows].sort((a, b) => a.strike - b.strike);
      const atmRow = atmOf(sorted, spot);
      const atmIdx = sorted.findIndex((r) => r.strike === atmRow.strike);
      const ivAt = (r: ChainRow): number => {
        // OTM wing: calls above spot, puts below, ATM = average.
        if (r.strike > spot) return impliedVol(r.call.ltp, { spot, strike: r.strike, timeYears: T, rate, type: 'CALL' });
        if (r.strike < spot) return impliedVol(r.put.ltp, { spot, strike: r.strike, timeYears: T, rate, type: 'PUT' });
        const c = impliedVol(r.call.ltp, { spot, strike: r.strike, timeYears: T, rate, type: 'CALL' });
        const p = impliedVol(r.put.ltp, { spot, strike: r.strike, timeYears: T, rate, type: 'PUT' });
        return (c + p) / 2;
      };
      const atmC = impliedVol(atmRow.call.ltp, { spot, strike: atmRow.strike, timeYears: T, rate, type: 'CALL' });
      const atmP = impliedVol(atmRow.put.ltp, { spot, strike: atmRow.strike, timeYears: T, rate, type: 'PUT' });
      const atmIV = (atmC + atmP) / 2;

      const cells = offsets.map((offset) => {
        const idx = atmIdx + offset;
        const r = sorted[idx];
        const iv = r ? ivAt(r) : atmIV;
        if (iv > 0.001 && iv < 3) {
          ivLo = Math.min(ivLo, iv);
          ivHi = Math.max(ivHi, iv);
        }
        return { offset, iv };
      });
      return { iso: s.iso, dte, atmIV, atmStrike: atmRow.strike, cells };
    })
    .sort((a, b) => a.dte - b.dte);

  if (!isFinite(ivLo)) {
    ivLo = 0.1;
    ivHi = 0.2;
  }
  return { spot, offsets, expiries, ivLo, ivHi };
}

export function computeFuturesArb(slices: ExpirySlice[], spot: number, rate: number, costPct = 0.1): ArbRow[] {
  return slices
    .filter((s) => s.rows.length > 0)
    .map((s) => {
      const dte = Math.max(daysBetween(todayIso(), s.iso), 0.25);
      const T = dte / 365;
      const atm = atmOf(s.rows, spot);
      const disc = Math.exp(rate * T);
      const impliedForward = (atm.call.ltp - atm.put.ltp) * disc + atm.strike;
      const fairForward = spot * disc;
      const basis = impliedForward - spot;
      const mispricing = impliedForward - fairForward;
      const threshold = spot * (costPct / 100);
      const signal: ArbRow['signal'] = mispricing > threshold ? 'RICH' : mispricing < -threshold ? 'CHEAP' : 'FAIR';
      return {
        iso: s.iso,
        dte,
        atmStrike: atm.strike,
        impliedForward,
        fairForward,
        basis,
        basisPct: spot > 0 ? (basis / spot) * 100 : 0,
        carryAnnPct: spot > 0 && T > 0 ? ((impliedForward / spot - 1) / T) * 100 : 0,
        mispricing,
        signal,
      };
    })
    .sort((a, b) => a.dte - b.dte);
}
