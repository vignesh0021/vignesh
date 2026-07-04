export type InstrumentKey = 'BTC' | 'NIFTY' | 'BANKNIFTY';

export interface InstrumentPreset {
  key: InstrumentKey;
  /** Short ticker shown in the UI / used on contract labels. */
  symbol: string;
  label: string;
  /** Yahoo Finance chart symbol used for the live spot quote. */
  yahoo: string;
  /** Default contract multiplier (units of underlying per lot). Editable per leg. */
  lotSize: number;
  /** Typical strike spacing — used to snap default strikes. */
  strikeStep: number;
  currency: string;
  /** Fallback IV (decimal) if the volatility index can't be fetched. */
  fallbackIv: number;
  /** Human label for the volatility source. */
  vixLabel: string;
}

/**
 * Preset underlyings. Spot is fetched live (Binance for BTC, Yahoo for the
 * Indian indices); a volatility index drives the default IV (Deribit DVOL for
 * BTC, India VIX for NIFTY / BANKNIFTY). Every value stays user-editable.
 */
export const INSTRUMENTS: Record<InstrumentKey, InstrumentPreset> = {
  BTC: {
    key: 'BTC',
    symbol: 'BTC',
    label: 'Bitcoin',
    yahoo: 'BTC-USD',
    lotSize: 0.001,
    strikeStep: 1000,
    currency: 'USD',
    fallbackIv: 0.55,
    vixLabel: 'DVOL',
  },
  NIFTY: {
    key: 'NIFTY',
    symbol: 'NIFTY',
    label: 'Nifty 50',
    yahoo: '^NSEI',
    lotSize: 75,
    strikeStep: 50,
    currency: 'INR',
    fallbackIv: 0.13,
    vixLabel: 'India VIX',
  },
  BANKNIFTY: {
    key: 'BANKNIFTY',
    symbol: 'BANKNIFTY',
    label: 'Bank Nifty',
    yahoo: '^NSEBANK',
    lotSize: 30,
    strikeStep: 100,
    currency: 'INR',
    fallbackIv: 0.15,
    vixLabel: 'India VIX',
  },
};

export const INSTRUMENT_KEYS: InstrumentKey[] = ['BTC', 'NIFTY', 'BANKNIFTY'];
