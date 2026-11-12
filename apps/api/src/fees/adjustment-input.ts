import { z } from 'zod';

const reason = z.string().trim().min(3, 'Give a reason of at least 3 characters').max(300);

/**
 * A voucher adjustment. Either `type` DISCOUNT or CHARGE with a positive amount, or a signed
 * amount alone (negative takes money off, positive adds a charge). Unknown fields and a `type`
 * that contradicts the sign are refused rather than guessed at. The output amount is signed.
 */
export const adjustmentSchema = z
  .strictObject({
    amount: z.number().int().min(-10_000_000).max(10_000_000),
    type: z.enum(['DISCOUNT', 'CHARGE']).optional(),
    reason,
    description: z.string().trim().max(80).optional(),
  })
  .superRefine((b, ctx) => {
    if (b.amount === 0) ctx.addIssue({ code: 'custom', path: ['amount'], message: 'Enter an amount above zero' });
    else if (b.type && b.amount < 0) {
      ctx.addIssue({ code: 'custom', path: ['amount'], message: 'With a type, enter the amount as a positive number' });
    }
  })
  .transform(({ type, ...b }) => ({ ...b, amount: type === 'DISCOUNT' ? -b.amount : b.amount }));
