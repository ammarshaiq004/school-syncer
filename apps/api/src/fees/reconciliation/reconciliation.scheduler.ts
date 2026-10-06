import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { SCHOOL_TIMEZONE } from '../../common/dates.js';
import { ReconciliationService } from './reconciliation.service.js';

/** How often the job checks whether a night's reconciliation is due. */
const TICK_MS = 15 * 60_000;

/**
 * Runs payment reconciliation every night in-process (there is no Redis or
 * job queue). RECONCILE_AT is the school-local time it starts, "02:00" by
 * default, or "off". Every tick after that time picks up any finished day
 * not yet reconciled, so a server that was down at 2am catches up when it
 * starts; the run rows make it safe with more than one server.
 */
@Injectable()
export class ReconciliationScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ReconciliationScheduler.name);
  private timers: NodeJS.Timeout[] = [];
  private running = false;

  constructor(private readonly reconciliation: ReconciliationService) {}

  onApplicationBootstrap() {
    const at = reconcileAt();
    if (!at || process.env.NODE_ENV === 'test') return;
    this.timers.push(setTimeout(() => void this.tick(at), 60_000).unref(), setInterval(() => void this.tick(at), TICK_MS).unref());
    this.logger.log(`Payment reconciliation runs nightly from ${at} (${SCHOOL_TIMEZONE}).`);
  }

  onApplicationShutdown() {
    this.timers.forEach((t) => clearTimeout(t));
  }

  async tick(at: string, now = new Date()) {
    if (this.running || localTime(now) < at) return;
    this.running = true;
    try {
      const ran = await this.reconciliation.runDue(now);
      if (ran) this.logger.log(`Reconciled ${ran} school days of online payments.`);
    } catch (error) {
      this.logger.error(`Nightly reconciliation failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
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
