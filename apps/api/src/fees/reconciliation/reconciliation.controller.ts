import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ReconciliationIssueStatus } from '@prisma/client';
import { z } from 'zod';
import { assertSchoolWide, FEE_ROLES } from '../../common/admin-roles.js';
import type { AuthUser } from '../../common/auth-user.js';
import { CurrentUser, Permission, RequiresFeature, Roles } from '../../common/decorators.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { ONLINE_PROVIDERS } from '../online-payments.service.js';
import { ReconciliationService } from './reconciliation.service.js';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-05');
const runSchema = z.object({ date: day });
const resolveSchema = z.object({ note: z.string().trim().min(3, 'Say what you found').max(500) });
const statementSchema = z.object({
  provider: z.enum(ONLINE_PROVIDERS),
  fileName: z.string().trim().min(1).max(200),
  grid: z.array(z.array(z.string().max(500)).max(80)).min(2).max(20_000),
});

/** Online payments settle to school-wide merchant accounts, so reconciling them is school-wide work. */
const NOT_WIDE = 'Only school-wide fee staff can reconcile online payments';

/** The fee office's daily check of online payments against the gateways (SCHOOL-78). */
@Controller('fees/reconciliation')
@Roles(...FEE_ROLES)
@Permission('fees')
@RequiresFeature('online_payments')
export class ReconciliationController {
  constructor(private readonly reconciliation: ReconciliationService) {}

  /** The last 30 days' runs, open issues by kind and recent statements. */
  @Get()
  overview(@CurrentUser() user: AuthUser) {
    assertSchoolWide(user, NOT_WIDE, FEE_ROLES);
    return this.reconciliation.overview(user.schoolId);
  }

  @Get('issues')
  issues(@CurrentUser() user: AuthUser, @Query('status') status?: string, @Query('date') date?: string) {
    assertSchoolWide(user, NOT_WIDE, FEE_ROLES);
    return this.reconciliation.issues(user.schoolId, {
      status: Object.values(ReconciliationIssueStatus).find((s) => s === status),
      date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined,
    });
  }

  /** Reconciles one finished day again now. */
  @Post('run')
  @HttpCode(200)
  run(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(runSchema)) body: z.infer<typeof runSchema>) {
    assertSchoolWide(user, NOT_WIDE, FEE_ROLES);
    return this.reconciliation.reconcile(user.schoolId, body.date, { trigger: 'manual', userId: user.sub });
  }

  @Post('issues/:id/resolve')
  @HttpCode(200)
  resolve(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(resolveSchema)) body: z.infer<typeof resolveSchema>,
  ) {
    assertSchoolWide(user, NOT_WIDE, FEE_ROLES);
    return this.reconciliation.resolve(user.schoolId, id, user.sub, body.note);
  }

  /** A statement from a gateway's merchant portal, read in the browser into rows of text. */
  @Post('statements')
  statement(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(statementSchema)) body: z.infer<typeof statementSchema>) {
    assertSchoolWide(user, NOT_WIDE, FEE_ROLES);
    return this.reconciliation.importStatement(user.schoolId, user.sub, body);
  }
}
