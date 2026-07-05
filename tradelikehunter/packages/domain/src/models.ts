import type { OptionType } from './options/blackScholes.js';

export type { OptionType };
export type { Greeks } from './options/greeks.js';

export type Action = 'BUY' | 'SELL';
export type LegKind = 'OPTION' | 'FUTURE';

/**
 * A single tradable leg. `entryPrice` is per unit of the underlying; the
 * economic multiplier is `size` (= lots × lotSize, always positive). Direction
 * comes from `action`.
 */
export interface Leg {
  kind: LegKind;
  /** Required for OPTION legs. */
  optType?: OptionType;
  action: Action;
  /** Ignored for FUTURE legs. */
  strike: number;
  entryPrice: number;
  /** Positive units of the underlying. */
  size: number;
  /** Implied volatility (decimal) — used to value OPTION legs. */
  iv: number;
  /** Time to expiry in years for this leg. */
  timeYears: number;
}

/** +1 for BUY (long), -1 for SELL (short). */
export function legSign(leg: Leg): number {
  return leg.action === 'BUY' ? 1 : -1;
}
