export type BrokerId = 'fyers' | 'dhan' | 'upstox' | 'zerodha' | 'angel';

/** A position normalised across brokers for the monitor UI. */
export interface BrokerPosition {
  broker: BrokerId;
  symbol: string;
  /** Signed quantity (negative = short). */
  qty: number;
  avgPrice: number; // entry
  ltp: number; // live mark / last price (0 if unknown)
  pnl: number; // unrealized PnL as reported/derived
  currency: string;
  productType?: string;
}

export interface BrokerError {
  message: string;
}
