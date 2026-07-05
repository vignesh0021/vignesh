import { z } from 'zod';

import { Action, InstrumentKind, OrderType, Product, Tif, lots, price } from './common.js';

/**
 * Place-order request. Cross-field rules enforce that the price/trigger fields
 * required by each order type are actually present — validated identically on
 * the client (form) and the server.
 */
export const OrderInput = z
  .object({
    instrumentKind: InstrumentKind,
    /** Contract/token id the order refers to. */
    instrumentRef: z.string().min(1),
    side: Action,
    product: Product.default('NRML'),
    type: OrderType,
    qtyLots: lots,
    price: price.optional(),
    triggerPrice: price.optional(),
    tif: Tif.default('DAY'),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'LIMIT' && v.price == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['price'], message: 'LIMIT orders require a price' });
    }
    if (v.type === 'SL') {
      if (v.price == null)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['price'], message: 'SL orders require a limit price' });
      if (v.triggerPrice == null)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['triggerPrice'], message: 'SL orders require a trigger price' });
    }
    if (v.type === 'SL_M' && v.triggerPrice == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['triggerPrice'], message: 'SL-M orders require a trigger price' });
    }
  });
export type OrderInput = z.infer<typeof OrderInput>;

export const BracketInput = z.object({
  base: OrderInput,
  target: price,
  stopLoss: price,
  trailAmount: price.optional(),
});
export type BracketInput = z.infer<typeof BracketInput>;

export const ModifyOrderInput = z.object({
  price: price.optional(),
  triggerPrice: price.optional(),
  qtyLots: lots.optional(),
});
export type ModifyOrderInput = z.infer<typeof ModifyOrderInput>;
