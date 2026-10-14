import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { localDate, SCHOOL_TIMEZONE } from '../../common/dates.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { ReconciliationService } from './reconciliation.service.js';

export const RECONCILE_QUEUE = 'reconciliation.nightly';

/**
 * Runs payment reconciliation every night as a scheduled job. RECONCILE_AT
 * is the school-local time it starts, "02:00" by default, or "off". The run
 * slot is the local date, enqueued under a unique key, so only one server
 * runs it however many there are; a server that was down at 2am enqueues the
 * slot when it comes back. runDue also picks up earlier days not yet
 * reconciled, and a failed run is retried by the job runner.
 */
@Injectable()
export class ReconciliationScheduler implements OnModuleInit {
  private readonly logger = new Logger(ReconciliationScheduler.name);

  constructor(
    private readonly reconciliation: ReconciliationService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit() {
    this.jobs.register(RECONCILE_QUEUE, {
      run: async () => {
        const ran = await this.reconciliation.runDue(new Date());
        if (ran) this.logger.log(`Reconciled ${ran} school days of online payments.`);
      },
      backoffMs: 5 * 60_000,
    });
    const at = reconcileAt();
    if (!at) return;
    this.jobs.schedule({ name: 'reconcile', queue: RECONCILE_QUEUE, slot: (now) => reconcileSlot(at, now), maxAttempts: 3 });
    if (process.env.NODE_ENV !== 'test') this.logger.log(`Payment reconciliation runs nightly from ${at} (${SCHOOL_TIMEZONE}).`);
  }
}

/** The local date once the day's start time has passed, else null. */
export function reconcileSlot(at: string, now: Date): string | null {
  return localTime(now) >= at ? localDate(now) : null;
}

/** "02:00" from RECONCILE_AT, or null when it is "off". */
export function reconcileAt(value = process.env.RECONCILE_AT): string | null {
  if (value?.trim().toLowerCase() === 'off') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value?.trim() ?? '');
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return '02:00';
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

/** "HH:MM" in the school timezone. */
export function localTime(at: Date, timeZone = SCHOOL_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
}
