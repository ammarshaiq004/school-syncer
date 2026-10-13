import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';
import { z } from 'zod';
import { FEE_ROLES } from '../common/admin-roles.js';
import type { AuthUser } from '../common/auth-user.js';
import { dateRange, nextDay } from '../common/date-range.js';
import { startOfLocalDay } from '../common/dates.js';
import { CurrentUser, Permission, RequiresFeature, Roles } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { FeeCorrectionsService } from './fee-corrections.service.js';

const reason = z.string().trim().min(3, 'Give a reason of at least 3 characters').max(300);
const reasonSchema = z.object({ reason });
const adjustmentSchema = z.object({
  amount: z
    .number()
    .int()
    .min(-10_000_000)
    .max(10_000_000)
    .refine((n) => n !== 0, 'Enter a discount (negative) or a charge (positive)'),
  reason,
  description: z.string().trim().max(80).optional(),
});

/**
 * The receipts list and corrections to fee money (SCHOOL-137). Writes need
 * fees "manage" (the class-level @Permission), reads need "view".
 */
@Controller('fees')
@Permission('fees')
@RequiresFeature('fees')
export class FeeCorrectionsController {
  constructor(private readonly corrections: FeeCorrectionsService) {}

  /** Receipts for a period (this month so far by default), reversed ones included and marked. */
  @Get('payments')
  @Roles(...FEE_ROLES)
  payments(
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('method') method?: string,
    @Query('reversed') reversed?: string,
    @Query('search') search?: string,
  ) {
    const r = dateRange(from, to);
    return this.corrections.payments(user, {
      from: startOfLocalDay(r.from),
      to: startOfLocalDay(nextDay(r.to)),
      method: method && method in PaymentMethod ? (method as PaymentMethod) : undefined,
      reversed: reversed === 'true' ? true : reversed === 'false' ? false : undefined,
      search,
    });
  }

  /** Reverses a counter or online payment; the receipt stays on record. */
  @Post('payments/:id/reverse')
  @HttpCode(200)
  @Roles(...FEE_ROLES)
  reverse(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reasonSchema)) body: z.infer<typeof reasonSchema>,
  ) {
    return this.corrections.reversePayment(user, id, body.reason);
  }

  /** Voids a voucher with no payments standing on it. */
  @Post('invoices/:id/cancel')
  @HttpCode(200)
  @Roles(...FEE_ROLES)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reasonSchema)) body: z.infer<typeof reasonSchema>,
  ) {
    return this.corrections.cancelInvoice(user, id, body.reason);
  }

  /** Adds a discount (negative) or extra charge (positive) line to a voucher. */
  @Post('invoices/:id/adjustments')
  @Roles(...FEE_ROLES)
  adjust(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(adjustmentSchema)) body: z.infer<typeof adjustmentSchema>,
  ) {
    return this.corrections.adjustInvoice(user, id, body);
  }
}
