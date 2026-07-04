export type OptionType = 'CALL' | 'PUT';
export type OptionAction = 'BUY' | 'SELL';
export type PositionStatus = 'OPEN' | 'CLOSED';

/**
 * A single option leg in the portfolio.
 *
 * `entryPremium` and `exitPremium` are quoted *per unit of the underlying*
 * (e.g. per BTC), matching how option premiums are shown on Delta Exchange.
 * The economic multiplier for a leg is `lots * lotSize`.
 */
export interface OptionPosition {
  id: string;
  instrument: string; // e.g. "BTC"
  type: OptionType;
  action: OptionAction;
  strike: number;
  /** ISO date string (yyyy-mm-dd) of expiry. */
  expiry: string;
  /** Premium paid/received per unit at entry. */
  entryPremium: number;
  /** Number of lots. */
  lots: number;
  /** Units of underlying per lot (contract multiplier). */
  lotSize: number;
  /** Implied volatility as a decimal (0.60 = 60%). */
  iv: number;
  /**
   * Last known current market price (mark / LTP) per unit, if the user entered
   * one. Used to calibrate `iv` to the live market so current PNL and Greeks
   * reflect reality rather than a guessed vol. Optional.
   */
  markPrice?: number;
  status: PositionStatus;
  /**
   * Frozen realized PNL, only set once the leg is CLOSED. Once frozen it never
   * recomputes and the leg contributes 0 to all live Greeks.
   */
  realizedPnl?: number;
  /** Premium per unit at which the leg was closed. */
  exitPremium?: number;
}

export interface Greeks {
  delta: number;
  gamma: number;
  theta: number; // per calendar day
  vega: number; // per 1% (1 vol point) change in IV
}

export interface PricedLeg {
  premium: number;
  greeks: Greeks;
}
