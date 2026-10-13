import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { COUNTER_STORE, type CounterStore } from './counter-store.js';
import { JobsService } from './jobs.service.js';

const SCHEDULE_TICK_MS = 60_000;

/** Whether this process runs workers: not with JOBS_WORKER=off, and never under tests (they call runOnce). */
export function workersEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.JOBS_WORKER?.trim().toLowerCase() !== 'off' && env.NODE_ENV !== 'test';
}

/**
 * Runs queued jobs in this API process: polls the Job table every
 * JOBS_POLL_MS (2s), runs up to JOBS_CONCURRENCY (5) at a time, and once a
 * minute enqueues due schedules and recovers jobs of dead workers. With
 * JOBS_WORKER=off the instance only enqueues; another one must run workers.
 * Also owns the hourly maintenance job (expired rate-limit counters, old
 * jobs, used reset codes).
 */
@Injectable()
export class JobWorker implements OnModuleInit, OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(JobWorker.name);
  private timers: NodeJS.Timeout[] = [];
  private polling: Promise<void> | null = null;
  private again = false;
  private stopped = false;

  constructor(
    private readonly jobs: JobsService,
    private readonly prisma: PrismaService,
    @Inject(COUNTER_STORE) private readonly counters: CounterStore,
  ) {}

  onModuleInit() {
    this.jobs.register('maintenance.cleanup', { run: () => this.cleanup() });
    this.jobs.schedule({
      name: 'cleanup',
      queue: 'maintenance.cleanup',
      // Once an hour (UTC hour slot).
      slot: (now) => now.toISOString().slice(0, 13),
      maxAttempts: 2,
    });
  }

  onApplicationBootstrap() {
    if (!workersEnabled()) {
      if (process.env.NODE_ENV !== 'test') this.logger.log('JOBS_WORKER=off: this instance runs no background jobs.');
      return;
    }
    const pollMs = Math.max(200, Number(process.env.JOBS_POLL_MS) || 2_000);
    this.jobs.onEnqueue = () => this.poll();
    this.timers.push(
      setInterval(() => this.poll(), pollMs).unref(),
      setInterval(() => void this.tickSchedules(), SCHEDULE_TICK_MS).unref(),
      setTimeout(() => void this.tickSchedules(), 5_000).unref(),
    );
    this.logger.log(`Background jobs: worker ${this.jobs.workerId} on ${this.jobs.queues.join(', ')}.`);
  }

  async onApplicationShutdown() {
    this.stopped = true;
    this.jobs.onEnqueue = undefined;
    this.timers.forEach((t) => clearInterval(t));
    // Let running jobs finish (up to 10s); anything cut off is recovered by another worker.
    if (this.polling) await Promise.race([this.polling, new Promise((r) => setTimeout(r, 10_000).unref())]);
  }

  /** Runs due jobs until none are left; a call while running makes it look once more. */
  poll() {
    if (this.stopped) return;
    if (this.polling) {
      this.again = true;
      return;
    }
    const concurrency = Math.max(1, Number(process.env.JOBS_CONCURRENCY) || 5);
    this.polling = (async () => {
      try {
        do {
          this.again = false;
          while (!this.stopped && (await this.jobs.runOnce({ limit: concurrency })) === concurrency);
        } while (this.again && !this.stopped);
      } catch (error) {
        this.logger.error(`Job polling failed: ${(error as Error).message}`);
      } finally {
        this.polling = null;
      }
    })();
  }

  async tickSchedules(now = new Date()) {
    try {
      await this.jobs.recoverStale(now);
      await this.jobs.enqueueDue(now);
    } catch (error) {
      this.logger.error(`Scheduling failed: ${(error as Error).message}`);
    }
  }

  async cleanup(now = new Date()) {
    const counters = await this.counters.sweep(now.getTime());
    const jobs = await this.jobs.purgeFinished(now);
    const { count: codes } = await this.prisma.passwordResetCode.deleteMany({
      where: { expiresAt: { lt: new Date(now.getTime() - 86_400_000) } },
    });
    if (counters + jobs + codes) this.logger.log(`Cleanup: ${counters} rate-limit windows, ${jobs} jobs, ${codes} reset codes.`);
  }
}
