import { BadRequestException } from '@nestjs/common';
import { startOfLocalDay } from '../common/dates.js';

/**
 * When a payment was received. No date (or today) means now; an earlier day is a back-dated
 * receipt, stamped at noon local time so every report puts it on that day. The future is refused.
 */
export function receivedInstant(paidOn: string | undefined, today: string, now = new Date()): Date {
  if (!paidOn || paidOn === today) return now;
  if (paidOn > today) throw new BadRequestException('Paid date cannot be in the future');
  return new Date(startOfLocalDay(paidOn).getTime() + 12 * 3_600_000);
}
