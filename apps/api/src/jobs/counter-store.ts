import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/** Injection token for the CounterStore the rate limiters use. */
export const COUNTER_STORE = Symbol('COUNTER_STORE');

export interface Counter {
  count: number;
  /** Epoch ms when the window ends. */
  resetAt: number;
}

/**
 * Fixed-window counters behind the rate limiters. Times are passed in (epoch
 * ms) so limiters and tests control the clock.
 */
export interface CounterStore {
  /** Counts one more in the key's window, starting a new window when there is none or it ended. */
  increment(key: string, windowMs: number, now: number): Promise<Counter>;
  /** The key's live window, or null. */
  get(key: string, now: number): Promise<Counter | null>;
  delete(key: string): Promise<void>;
  /** Drops ended windows; returns how many. */
  sweep(now: number): Promise<number>;
}

/** A timestamp the way Prisma stores DateTime (UTC, without time zone). */
const ts = (ms: number) => new Date(ms).toISOString();

/**
 * Counters in the RateLimitCounter table, so every API instance shares them
 * and they survive restarts. One upsert per hit; ended windows are removed
 * by the hourly maintenance job. RATE_LIMIT_NAMESPACE prefixes every key
 * (the e2e suites give each test file its own).
 */
@Injectable()
export class PgCounterStore implements CounterStore {
  private readonly ns = process.env.RATE_LIMIT_NAMESPACE ? `${process.env.RATE_LIMIT_NAMESPACE}:` : '';

  constructor(private readonly prisma: PrismaService) {}

  async increment(key: string, windowMs: number, now: number): Promise<Counter> {
    const [row] = await this.prisma.$queryRaw<{ count: number; expiresAt: Date }[]>`
      INSERT INTO "RateLimitCounter" ("key", "count", "expiresAt")
      VALUES (${this.ns + key}, 1, ${ts(now + windowMs)}::timestamp)
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "RateLimitCounter"."expiresAt" <= ${ts(now)}::timestamp THEN 1
                       ELSE "RateLimitCounter"."count" + 1 END,
        "expiresAt" = CASE WHEN "RateLimitCounter"."expiresAt" <= ${ts(now)}::timestamp THEN EXCLUDED."expiresAt"
                           ELSE "RateLimitCounter"."expiresAt" END
      RETURNING "count", "expiresAt"`;
    return { count: Number(row.count), resetAt: row.expiresAt.getTime() };
  }

  async get(key: string, now: number): Promise<Counter | null> {
    const row = await this.prisma.rateLimitCounter.findUnique({ where: { key: this.ns + key } });
    if (!row || row.expiresAt.getTime() <= now) return null;
    return { count: row.count, resetAt: row.expiresAt.getTime() };
  }

  async delete(key: string): Promise<void> {
    await this.prisma.rateLimitCounter.deleteMany({ where: { key: this.ns + key } });
  }

  async sweep(now: number): Promise<number> {
    const { count } = await this.prisma.rateLimitCounter.deleteMany({ where: { expiresAt: { lte: new Date(now) } } });
    return count;
  }
}

/** In-process counters, for unit tests. */
export class MemoryCounterStore implements CounterStore {
  private counters = new Map<string, Counter>();

  async increment(key: string, windowMs: number, now: number): Promise<Counter> {
    let c = await this.get(key, now);
    if (!c) {
      c = { count: 0, resetAt: now + windowMs };
      this.counters.set(key, c);
    }
    c.count += 1;
    return { ...c };
  }

  async get(key: string, now: number): Promise<Counter | null> {
    const c = this.counters.get(key);
    return c && c.resetAt > now ? c : null;
  }

  async delete(key: string): Promise<void> {
    this.counters.delete(key);
  }

  async sweep(now: number): Promise<number> {
    let n = 0;
    for (const [key, c] of this.counters) if (c.resetAt <= now && this.counters.delete(key)) n++;
    return n;
  }
}
