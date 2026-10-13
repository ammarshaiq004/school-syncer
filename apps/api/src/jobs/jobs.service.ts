import { Injectable, Logger } from '@nestjs/common';
import { JobStatus, Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { PrismaService } from '../prisma/prisma.service.js';

/** What a handler sees of the job it runs. */
export interface JobInfo {
  id: string;
  queue: string;
  /** This attempt's number, from 1. */
  attempt: number;
  maxAttempts: number;
}

export interface JobHandler<P = Record<string, unknown>> {
  run(payload: P, job: JobInfo): Promise<void>;
  /** After an attempt failed and another is scheduled. */
  retrying?(payload: P, job: JobInfo, error: Error): Promise<void>;
  /** After the last attempt failed (or a PermanentJobError). */
  failed?(payload: P, job: JobInfo, error: Error): Promise<void>;
  /** What is kept of the payload once the job is finished, e.g. to drop secrets. */
  scrub?(payload: P): Record<string, unknown>;
  /** Delay before the first retry; doubles each time. Default 30 seconds. */
  backoffMs?: number;
}

/** A failure that retrying cannot fix (bad number, rejected credentials): the job fails at once. */
export class PermanentJobError extends Error {}

/** A run slot of a recurring job: enqueued once per slot across every server. */
export interface Schedule {
  name: string;
  queue: string;
  /** The slot due at `now` ("2026-10-13"), or null when nothing is due yet. */
  slot(now: Date): string | null;
  payload?: Record<string, unknown>;
  maxAttempts?: number;
}

interface ClaimedJob {
  id: string;
  queue: string;
  payload: Prisma.JsonValue;
  attempts: number;
  maxAttempts: number;
}

export const DEFAULT_MAX_ATTEMPTS = 5;
const MAX_BACKOFF_MS = 6 * 60 * 60_000;
/** A RUNNING job locked longer than this belonged to a worker that died; it is retried. */
export const LOCK_TIMEOUT_MS = 10 * 60_000;

/** Delay before retry n (1 = first retry): base, 2x, 4x... capped at 6 hours. */
export function backoffMs(retry: number, base = 30_000): number {
  return Math.min(base * 2 ** Math.max(0, retry - 1), MAX_BACKOFF_MS);
}

/** A timestamp the way Prisma stores DateTime (UTC, without time zone). */
const ts = (at: Date) => at.toISOString();

/**
 * A small job queue in Postgres (the Job table), so background work survives
 * restarts and runs once however many API instances there are. Workers
 * claim due jobs with SELECT ... FOR UPDATE SKIP LOCKED, so two workers never
 * take the same job; a failed job is retried with exponential backoff until
 * maxAttempts, then marked FAILED with the error. Recurring work is enqueued
 * per run slot under a unique key, so each slot runs once across servers.
 * JobWorker drives the polling; tests call runOnce() directly.
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);
  private handlers = new Map<string, JobHandler<never>>();
  readonly schedules: Schedule[] = [];
  /** Set by JobWorker so new jobs start without waiting for the next poll. */
  onEnqueue?: () => void;

  readonly workerId = `${hostname()}:${process.pid}:${randomBytes(3).toString('hex')}`;

  constructor(private readonly prisma: PrismaService) {}

  register<P>(queue: string, handler: JobHandler<P>) {
    this.handlers.set(queue, handler as JobHandler<never>);
  }

  schedule(schedule: Schedule) {
    this.schedules.push(schedule);
  }

  get queues() {
    return [...this.handlers.keys()];
  }

  async enqueue(
    queue: string,
    payload: Record<string, unknown>,
    opts: { runAt?: Date; maxAttempts?: number; uniqueKey?: string; priority?: number } = {},
  ): Promise<string | null> {
    try {
      const job = await this.prisma.job.create({
        data: {
          queue,
          payload: payload as Prisma.InputJsonObject,
          runAt: opts.runAt ?? new Date(),
          maxAttempts: opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
          uniqueKey: opts.uniqueKey,
          priority: opts.priority ?? 0,
        },
      });
      this.onEnqueue?.();
      return job.id;
    } catch (error) {
      // Another server already enqueued this slot.
      if (opts.uniqueKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return null;
      throw error;
    }
  }

  /** Enqueues several jobs of one queue in one statement (inside `tx` when given). */
  async enqueueMany(
    queue: string,
    payloads: Record<string, unknown>[],
    opts: { maxAttempts?: number; priority?: number; tx?: Prisma.TransactionClient } = {},
  ) {
    if (!payloads.length) return;
    await (opts.tx ?? this.prisma).job.createMany({
      data: payloads.map((payload) => ({
        queue,
        payload: payload as Prisma.InputJsonObject,
        maxAttempts: opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        priority: opts.priority ?? 0,
      })),
    });
    if (!opts.tx) this.onEnqueue?.();
  }

  /** Enqueues every schedule's current slot that is not enqueued yet. */
  async enqueueDue(now = new Date()) {
    for (const s of this.schedules) {
      const slot = s.slot(now);
      if (!slot) continue;
      await this.enqueue(s.queue, s.payload ?? {}, { uniqueKey: `schedule:${s.name}:${slot}`, maxAttempts: s.maxAttempts });
    }
  }

  /**
   * Claims up to `limit` due jobs for this worker and runs them; returns how
   * many ran. `now` moves the clock forward in tests.
   */
  async runOnce(opts: { limit?: number; queues?: string[]; now?: Date; workerId?: string } = {}): Promise<number> {
    const queues = opts.queues ?? this.queues;
    if (!queues.length) return 0;
    const now = opts.now ?? new Date();
    const workerId = opts.workerId ?? this.workerId;
    const jobs = await this.prisma.$queryRaw<ClaimedJob[]>`
      UPDATE "Job" SET "status" = 'RUNNING', "lockedAt" = ${ts(now)}::timestamp, "lockedBy" = ${workerId},
        "attempts" = "attempts" + 1
      WHERE "id" IN (
        SELECT "id" FROM "Job"
        WHERE "status" = 'PENDING' AND "runAt" <= ${ts(now)}::timestamp AND "queue" = ANY(${queues})
        ORDER BY "priority" DESC, "runAt"
        LIMIT ${opts.limit ?? 10}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "queue", "payload", "attempts", "maxAttempts"`;
    await Promise.all(jobs.map((job) => this.process(job, workerId, now)));
    return jobs.length;
  }

  private async process(job: ClaimedJob, workerId: string, now: Date) {
    const handler = this.handlers.get(job.queue) as JobHandler<Record<string, unknown>> | undefined;
    const payload = (job.payload ?? {}) as Record<string, unknown>;
    const info: JobInfo = { id: job.id, queue: job.queue, attempt: job.attempts, maxAttempts: job.maxAttempts };
    const mine = { id: job.id, lockedBy: workerId, status: JobStatus.RUNNING };
    const scrubbed = () => (handler?.scrub ? (handler.scrub(payload) as Prisma.InputJsonObject) : undefined);
    try {
      if (!handler) throw new PermanentJobError(`No handler for queue ${job.queue}`);
      await handler.run(payload, info);
      await this.prisma.job.updateMany({
        where: mine,
        data: { status: JobStatus.DONE, finishedAt: new Date(), lockedAt: null, lockedBy: null, lastError: null, payload: scrubbed() },
      });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      const lastError = error.message.slice(0, 1000);
      if (error instanceof PermanentJobError || job.attempts >= job.maxAttempts) {
        await this.prisma.job.updateMany({
          where: mine,
          data: { status: JobStatus.FAILED, finishedAt: new Date(), lockedAt: null, lockedBy: null, lastError, payload: scrubbed() },
        });
        this.logger.warn(`Job ${job.queue} ${job.id} failed after ${job.attempts} attempt(s): ${lastError}`);
        await handler?.failed?.(payload, info, error).catch((err: Error) => this.logger.error(`failed() of ${job.id}: ${err.message}`));
      } else {
        const runAt = new Date(now.getTime() + backoffMs(job.attempts, handler?.backoffMs));
        await this.prisma.job.updateMany({
          where: mine,
          data: { status: JobStatus.PENDING, runAt, lockedAt: null, lockedBy: null, lastError },
        });
        await handler?.retrying?.(payload, info, error).catch((err: Error) => this.logger.error(`retrying() of ${job.id}: ${err.message}`));
      }
    }
  }

  /** Puts jobs whose worker died mid-run back in the queue (or fails them when out of attempts). */
  async recoverStale(now = new Date()) {
    const cutoff = new Date(now.getTime() - LOCK_TIMEOUT_MS);
    const stale = { status: JobStatus.RUNNING, lockedAt: { lt: cutoff } };
    const failed = await this.prisma.job.updateMany({
      where: { ...stale, attempts: { gte: this.prisma.job.fields.maxAttempts } },
      data: { status: JobStatus.FAILED, finishedAt: now, lockedAt: null, lockedBy: null, lastError: 'The worker stopped while running this job' },
    });
    const retried = await this.prisma.job.updateMany({
      where: stale,
      data: { status: JobStatus.PENDING, runAt: now, lockedAt: null, lockedBy: null, lastError: 'The worker stopped while running this job' },
    });
    return failed.count + retried.count;
  }

  /** Removes finished jobs: done ones after a week, failed ones after a month. */
  async purgeFinished(now = new Date()) {
    const days = (n: number) => new Date(now.getTime() - n * 86_400_000);
    const { count } = await this.prisma.job.deleteMany({
      where: {
        OR: [
          { status: JobStatus.DONE, finishedAt: { lt: days(7) } },
          { status: JobStatus.FAILED, finishedAt: { lt: days(30) } },
        ],
      },
    });
    return count;
  }
}
