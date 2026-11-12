import { BadRequestException } from '@nestjs/common';

/**
 * Checks an advance-credit entry: a whole, non-zero amount, never dated in the future, and a
 * withdrawal (negative) no bigger than the credit held. Returns the amount to store.
 */
export function creditEntry(amount: number, held: number, effectiveOn: string, today: string): number {
  if (!Number.isInteger(amount) || amount === 0) throw new BadRequestException('Enter a whole amount, not zero');
  if (effectiveOn > today) throw new BadRequestException('Date cannot be in the future');
  if (amount < 0 && -amount > held) {
    throw new BadRequestException(`Only Rs ${held.toLocaleString('en-PK')} of advance credit is held`);
  }
  return amount;
}

/** How much of a student's advance credit a voucher billing `billed` rupees takes. */
export const creditToApply = (held: number, billed: number): number => Math.max(0, Math.min(held, billed));
