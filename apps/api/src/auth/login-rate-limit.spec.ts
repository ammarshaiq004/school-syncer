import { HttpException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import {
  checkNoPassword,
  LOGIN_WINDOW_MS,
  LoginRateLimiter,
  MAX_FAILED_LOGINS,
} from './login-rate-limit.js';
import { MemoryCounterStore } from '../jobs/counter-store.js';

describe('LoginRateLimiter', () => {
  let now = 0;
  const limiter = () => {
    const l = new LoginRateLimiter(new MemoryCounterStore());
    l.now = () => now;
    return l;
  };
  const key = LoginRateLimiter.key('school', ' Owner@Demo.pk ', '1.2.3.4');

  beforeEach(() => {
    now = 1_000_000;
  });

  it('normalises the login in the key', () => {
    expect(key).toBe('school|owner@demo.pk|1.2.3.4');
    expect(LoginRateLimiter.key('platform', 'a@b.pk')).toBe('platform|a@b.pk|-');
  });

  it('refuses after too many failures, with 429', async () => {
    const l = limiter();
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
      await l.assertAllowed(key);
      await l.recordFailure(key);
    }
    let error: unknown;
    try {
      await l.assertAllowed(key);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect((error as HttpException).message).toMatch(/15 minutes/);
    // Other logins and addresses are unaffected.
    await l.assertAllowed(LoginRateLimiter.key('school', 'owner@demo.pk', '5.6.7.8'));
  });

  it('lets people back in after the window', async () => {
    const l = limiter();
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) await l.recordFailure(key);
    now += LOGIN_WINDOW_MS;
    await expect(l.assertAllowed(key)).resolves.toBeUndefined();
  });

  it('clears the count on a successful sign-in', async () => {
    const l = limiter();
    for (let i = 0; i < MAX_FAILED_LOGINS - 1; i++) await l.recordFailure(key);
    await l.recordSuccess(key);
    await l.recordFailure(key);
    await expect(l.assertAllowed(key)).resolves.toBeUndefined();
  });
});

describe('checkNoPassword', () => {
  it('runs a full-cost password check that never matches', async () => {
    const compare = vi.spyOn(bcrypt, 'compare');
    expect(await checkNoPassword('password123')).toBe(false);
    const hash = compare.mock.calls[0][1];
    expect(bcrypt.getRounds(hash)).toBe(12);
    compare.mockRestore();
  });
});
