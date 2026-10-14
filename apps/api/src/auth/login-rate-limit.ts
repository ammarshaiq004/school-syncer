import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { COUNTER_STORE, type CounterStore } from '../jobs/counter-store.js';

export const MAX_FAILED_LOGINS = 10;
export const LOGIN_WINDOW_MS = 15 * 60_000;

/** A bcrypt hash (12 rounds, like real passwords) of a random string nobody knows. */
const DUMMY_HASH = '$2b$12$dVCpNvShNK53tUf2cUXlJOEvScONCoAxqGHFvorNbTDXotPUOLBBK';

/**
 * Spends the time of a password check when there was no account to check
 * against, so a sign-in for an unknown school or login takes as long as a
 * wrong password and response times do not reveal who has an account.
 */
export async function checkNoPassword(password: string): Promise<false> {
  await bcrypt.compare(password, DUMMY_HASH);
  return false;
}

/**
 * Slows down password guessing: after 10 failed sign-ins for the same login
 * from the same address within 15 minutes, further attempts get 429 until the
 * window passes. The counts live in the shared CounterStore (Postgres), so
 * every API instance sees them and a restart does not reset them.
 */
@Injectable()
export class LoginRateLimiter {
  /** Replaceable in tests. */
  now: () => number = Date.now;

  constructor(@Inject(COUNTER_STORE) private readonly store: CounterStore) {}

  static key(scope: 'platform' | 'school', login: string, ip?: string) {
    return `${scope}|${login.trim().toLowerCase()}|${ip ?? '-'}`;
  }

  /** Throws 429 when this key has used up its attempts. */
  async assertAllowed(key: string) {
    const counter = await this.store.get(`login|${key}`, this.now());
    if (counter && counter.count >= MAX_FAILED_LOGINS) {
      const minutes = Math.max(1, Math.ceil((counter.resetAt - this.now()) / 60_000));
      throw new HttpException(
        `Too many failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async recordFailure(key: string) {
    await this.store.increment(`login|${key}`, LOGIN_WINDOW_MS, this.now());
  }

  async recordSuccess(key: string) {
    await this.store.delete(`login|${key}`);
  }
}
