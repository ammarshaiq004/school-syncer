import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

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

interface Window {
  count: number;
  startedAt: number;
}

/**
 * Applies @RateLimit: a fixed window per route group and client IP, answering
 * 429 once the allowance is used. Kept in memory like the sign-in limiter, so
 * it is per API process and resets on restart; swap for a shared store when
 * running more than one instance. The client IP honours TRUST_PROXY.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private windows = new Map<string, Window>();

  /** Replaceable in tests. */
  now: () => number = Date.now;

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const rule = this.reflector.getAllAndOverride<RateLimitRule | undefined>(RATE_LIMIT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!rule) return true;
    const req = context.switchToHttp().getRequest<Request>();
    this.hit(`${rule.name}|${req.ip ?? '-'}`, rule);
    return true;
  }

  /** Counts one request; throws 429 when the window's allowance is used up. */
  hit(key: string, rule: RateLimitRule) {
    const now = this.now();
    let window = this.windows.get(key);
    if (!window || now - window.startedAt >= rule.windowMs) {
      window = { count: 0, startedAt: now };
      this.windows.set(key, window);
      if (this.windows.size > 10_000) this.sweep();
    }
    window.count += 1;
    if (window.count > rule.max) {
      const minutes = Math.max(1, Math.ceil((window.startedAt + rule.windowMs - now) / 60_000));
      throw new HttpException(
        `Too many requests. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Drops finished windows; no rule uses one longer than LONGEST_WINDOW_MS. */
  private sweep() {
    const cutoff = this.now() - LONGEST_WINDOW_MS;
    for (const [key, w] of this.windows) if (w.startedAt < cutoff) this.windows.delete(key);
  }
}
