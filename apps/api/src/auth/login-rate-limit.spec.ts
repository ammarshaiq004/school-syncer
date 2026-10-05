import { HttpException } from '@nestjs/common';
import {
  LOGIN_WINDOW_MS,
  LoginRateLimiter,
  MAX_FAILED_LOGINS,
} from './login-rate-limit.js';

describe('LoginRateLimiter', () => {
  let now = 0;
  const limiter = () => {
    const l = new LoginRateLimiter();
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

  it('refuses after too many failures, with 429', () => {
    const l = limiter();
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
      l.assertAllowed(key);
      l.recordFailure(key);
    }
    let error: unknown;
    try {
      l.assertAllowed(key);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect((error as HttpException).message).toMatch(/15 minutes/);
    // Other logins and addresses are unaffected.
    l.assertAllowed(LoginRateLimiter.key('school', 'owner@demo.pk', '5.6.7.8'));
  });

  it('lets people back in after the window', () => {
    const l = limiter();
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) l.recordFailure(key);
    now += LOGIN_WINDOW_MS;
    expect(() => l.assertAllowed(key)).not.toThrow();
  });

  it('clears the count on a successful sign-in', () => {
    const l = limiter();
    for (let i = 0; i < MAX_FAILED_LOGINS - 1; i++) l.recordFailure(key);
    l.recordSuccess(key);
    l.recordFailure(key);
    expect(() => l.assertAllowed(key)).not.toThrow();
  });
});
