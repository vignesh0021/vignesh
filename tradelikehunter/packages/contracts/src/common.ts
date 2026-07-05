import { z } from 'zod';

/** Shared enums — the vocabulary used across API, DB and UI. */
export const OptionType = z.enum(['CALL', 'PUT']);
export const Action = z.enum(['BUY', 'SELL']);
export const InstrumentKind = z.enum(['OPTION', 'FUTURE']);
export const OrderType = z.enum(['MARKET', 'LIMIT', 'SL', 'SL_M']);
export const Product = z.enum(['NRML', 'MIS']);
export const Tif = z.enum(['DAY', 'IOC']);
export const OrderStatus = z.enum([
  'PENDING',
  'OPEN',
  'PARTIAL',
  'FILLED',
  'CANCELLED',
  'REJECTED',
  'TRIGGER_PENDING',
]);
export const PositionStatus = z.enum(['OPEN', 'CLOSED']);
export const MarketView = z.enum(['BULLISH', 'BEARISH', 'NEUTRAL', 'VOLATILE']);

export type OptionType = z.infer<typeof OptionType>;
export type Action = z.infer<typeof Action>;
export type InstrumentKind = z.infer<typeof InstrumentKind>;
export type OrderType = z.infer<typeof OrderType>;
export type Product = z.infer<typeof Product>;
export type Tif = z.infer<typeof Tif>;
export type OrderStatus = z.infer<typeof OrderStatus>;
export type PositionStatus = z.infer<typeof PositionStatus>;
export type MarketView = z.infer<typeof MarketView>;

/** Positive, finite money/price. */
export const price = z.number().finite().positive();
export const lots = z.number().int().positive();
