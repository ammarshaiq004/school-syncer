import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';

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

interface Bucket {
  failures: number;
  firstAt: number;
}

/**
 * Slows down password guessing: after 10 failed sign-ins for the same login
 * from the same address within 15 minutes, further attempts get 429 until the
 * window passes. Kept in memory, so it is per API process and resets on
 * restart; good enough for one instance, swap for a shared store when scaled.
 */
@Injectable()
export class LoginRateLimiter {
  private buckets = new Map<string, Bucket>();

  /** Replaceable in tests. */
  now: () => number = Date.now;

  static key(scope: 'platform' | 'school', login: string, ip?: string) {
    return `${scope}|${login.trim().toLowerCase()}|${ip ?? '-'}`;
  }

  /** Throws 429 when this key has used up its attempts. */
  assertAllowed(key: string) {
    const bucket = this.current(key);
    if (bucket && bucket.failures >= MAX_FAILED_LOGINS) {
      const minutes = Math.ceil(
        (bucket.firstAt + LOGIN_WINDOW_MS - this.now()) / 60_000,
      );
      throw new HttpException(
        `Too many failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  recordFailure(key: string) {
    const bucket = this.current(key) ?? { failures: 0, firstAt: this.now() };
    bucket.failures += 1;
    this.buckets.set(key, bucket);
    if (this.buckets.size > 10_000) this.sweep();
  }

  recordSuccess(key: string) {
    this.buckets.delete(key);
  }

  private current(key: string): Bucket | undefined {
    const bucket = this.buckets.get(key);
    if (bucket && this.now() - bucket.firstAt >= LOGIN_WINDOW_MS) {
      this.buckets.delete(key);
      return undefined;
    }
    return bucket;
  }

  private sweep() {
    for (const key of this.buckets.keys()) this.current(key);
  }
}
