import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { SCHOOL_TIMEZONE } from '../../common/dates.js';
import { reconcileAt, reconcileSlot } from '../../fees/reconciliation/reconciliation.scheduler.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { BillingService } from './billing.service.js';

export const BILLING_QUEUE = 'platform.billing.daily';

/**
 * Runs SchoolSyncer's billing every morning (BILLING_AT, school-local time,
 * "06:00" by default, or "off"): bills on the 1st, past-due status and
 * reminders. One run per day across all servers; a server that was down
 * catches up when it starts, and a failed run is retried.
 */
@Injectable()
export class BillingScheduler implements OnModuleInit {
  private readonly logger = new Logger(BillingScheduler.name);

  constructor(
    private readonly billing: BillingService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit() {
    this.jobs.register(BILLING_QUEUE, {
      run: async () => {
        const r = await this.billing.runDaily(new Date());
        this.logger.log(
          `Billing for ${r.today}: ${r.billed} bills issued, ${r.pastDue} schools now past due, ${r.cleared} cleared, ${r.reminders} reminders sent.`,
        );
      },
      backoffMs: 10 * 60_000,
    });
    const value = process.env.BILLING_AT ?? '06:00';
    const at = reconcileAt(value);
    if (!at) return;
    this.jobs.schedule({ name: 'billing', queue: BILLING_QUEUE, slot: (now) => reconcileSlot(at, now), maxAttempts: 3 });
    if (process.env.NODE_ENV !== 'test') this.logger.log(`SchoolSyncer billing runs daily at ${at} (${SCHOOL_TIMEZONE}).`);
  }
}
