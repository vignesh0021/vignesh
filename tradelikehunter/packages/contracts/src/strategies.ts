import { z } from 'zod';

import { Action, InstrumentKind, OptionType, lots } from './common.js';

export const LegInput = z.object({
  kind: InstrumentKind.default('OPTION'),
  optType: OptionType.optional(),
  action: Action,
  strike: z.number().nonnegative(),
  lots,
  /** Optional explicit entry premium; otherwise priced at market on execute. */
  entryPrice: z.number().nonnegative().optional(),
}).superRefine((v, ctx) => {
  if (v.kind === 'OPTION' && v.optType == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['optType'], message: 'Option legs need CALL or PUT' });
  }
});
export type LegInput = z.infer<typeof LegInput>;

export const BuildStrategyInput = z.object({
  underlyingSymbol: z.string().min(1),
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expiry must be yyyy-mm-dd'),
  name: z.string().min(1).max(60).optional(),
  legs: z.array(LegInput).min(1, 'A strategy needs at least one leg'),
});
export type BuildStrategyInput = z.infer<typeof BuildStrategyInput>;

export const FromTemplateInput = z.object({
  slug: z.string().min(1),
  underlyingSymbol: z.string().min(1),
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type FromTemplateInput = z.infer<typeof FromTemplateInput>;
