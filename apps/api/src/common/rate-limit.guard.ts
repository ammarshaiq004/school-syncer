import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { COUNTER_STORE, type CounterStore } from '../jobs/counter-store.js';

export const RATE_LIMIT = 'rateLimit';
export const LONGEST_WINDOW_MS = 60 * 60_000;

export interface RateLimitRule {
  /** Groups the routes that share one allowance, e.g. "enquiry". */
  name: string;
  /** Requests allowed per address within the window. */
  max: number;
  /** At most LONGEST_WINDOW_MS. */
  windowMs: number;
}

/**
 * Caps how often one address may call a public route (sign-up, enquiry
 * forms, certificate checks), so they cannot be flooded or scraped.
 */
export const RateLimit = (name: string, max: number, windowMs: number) =>
  SetMetadata(RATE_LIMIT, { name, max, windowMs } satisfies RateLimitRule);

/**
 * Applies @RateLimit: a fixed window per route group and client IP, answering
 * 429 once the allowance is used. The counts live in the shared CounterStore
 * (Postgres), like the sign-in limiter, so the allowance holds across API
 * instances and restarts. The client IP honours TRUST_PROXY.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  /** Replaceable in tests. */
  now: () => number = Date.now;

  constructor(
    private readonly reflector: Reflector,
    @Inject(COUNTER_STORE) private readonly store: CounterStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.getAllAndOverride<RateLimitRule | undefined>(RATE_LIMIT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!rule) return true;
    const req = context.switchToHttp().getRequest<Request>();
    await this.hit(`${rule.name}|${req.ip ?? '-'}`, rule);
    return true;
  }

  /** Counts one request; throws 429 when the window's allowance is used up. */
  async hit(key: string, rule: RateLimitRule) {
    const now = this.now();
    const counter = await this.store.increment(`route|${key}`, Math.min(rule.windowMs, LONGEST_WINDOW_MS), now);
    if (counter.count > rule.max) throw tooManyRequests(counter.resetAt - now);
  }
}

/** 429 with how long to wait. */
export function tooManyRequests(waitMs: number) {
  const minutes = Math.max(1, Math.ceil(waitMs / 60_000));
  return new HttpException(
    `Too many requests. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    HttpStatus.TOO_MANY_REQUESTS,
  );
}
