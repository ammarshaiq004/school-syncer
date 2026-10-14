import { HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MemoryCounterStore } from '../jobs/counter-store.js';
import { RateLimitGuard, type RateLimitRule } from './rate-limit.guard.js';

describe('RateLimitGuard', () => {
  let now = 0;
  const rule: RateLimitRule = { name: 'enquiry', max: 3, windowMs: 10 * 60_000 };
  const guard = () => {
    const g = new RateLimitGuard(new Reflector(), new MemoryCounterStore());
    g.now = () => now;
    return g;
  };

  beforeEach(() => {
    now = 1_000_000;
  });

  it('allows the allowance, then answers 429 until the window passes', async () => {
    const g = guard();
    for (let i = 0; i < rule.max; i++) await g.hit('enquiry|1.2.3.4', rule);
    let error: unknown;
    try {
      await g.hit('enquiry|1.2.3.4', rule);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect((error as HttpException).message).toBe('Too many requests. Try again in 10 minutes.');
    now += rule.windowMs;
    await expect(g.hit('enquiry|1.2.3.4', rule)).resolves.toBeUndefined();
  });

  it('counts each address separately', async () => {
    const g = guard();
    for (let i = 0; i < rule.max; i++) await g.hit('enquiry|1.2.3.4', rule);
    await expect(g.hit('enquiry|5.6.7.8', rule)).resolves.toBeUndefined();
  });
});
