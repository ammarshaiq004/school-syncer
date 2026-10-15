import { EventEmitter } from 'node:events';
import type { NextFunction, Request, Response } from 'express';
import { ApiErrorCounter } from './api-errors.js';
import { JsonLogger, jsonLogsEnabled } from './json-logger.js';
import { currentRequestId, requestContext, requestIdFrom, requestIdMiddleware, withRequestContext } from './request-context.js';
import type { Counter, CounterStore } from '../jobs/counter-store.js';

describe('request ids', () => {
  it('keeps an incoming id that looks like one, otherwise makes a UUID', () => {
    expect(requestIdFrom('edge-1234abcd')).toBe('edge-1234abcd');
    expect(requestIdFrom(['first-12345678', 'second-1234'])).toBe('first-12345678');
    for (const bad of [undefined, '', 'short', 'has spaces in it', 'line\nbreak-123456', 'x'.repeat(200)]) {
      expect(requestIdFrom(bad)).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('runs the request in its context and echoes the id', () => {
    const res = Object.assign(new EventEmitter(), { statusCode: 200, setHeader: vi.fn() });
    const finished = vi.fn();
    let seen: string | undefined;
    const next: NextFunction = () => {
      seen = currentRequestId();
    };
    requestIdMiddleware(finished)({ headers: { 'x-request-id': 'lb-12345678' }, method: 'GET', originalUrl: '/api/x?y=1' } as unknown as Request, res as unknown as Response, next);
    expect(seen).toBe('lb-12345678');
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', 'lb-12345678');
    res.emit('finish');
    expect(finished.mock.calls[0][3]).toEqual({ requestId: 'lb-12345678', method: 'GET', path: '/api/x' });
    expect(currentRequestId()).toBeUndefined();
  });

  it('gives work outside a request its own context', () => {
    expect(withRequestContext({ requestId: 'job:1' }, () => requestContext())).toEqual({ requestId: 'job:1' });
  });
});

describe('JsonLogger', () => {
  it('is on in production unless LOG_FORMAT says otherwise', () => {
    expect(jsonLogsEnabled({ NODE_ENV: 'production' })).toBe(true);
    expect(jsonLogsEnabled({ NODE_ENV: 'production', LOG_FORMAT: 'pretty' })).toBe(false);
    expect(jsonLogsEnabled({ LOG_FORMAT: 'JSON' })).toBe(true);
    expect(jsonLogsEnabled({})).toBe(false);
  });

  it('writes one JSON object per line with the request id', () => {
    const out: string[] = [];
    const err: string[] = [];
    const logger = new JsonLogger((l) => out.push(l), (l) => err.push(l));
    withRequestContext({ requestId: 'req-12345678' }, () => logger.log('Started', 'Bootstrap'));
    logger.warn({ message: 'request', status: 404 }, 'HTTP');
    logger.error('Boom', 'Error: Boom\n    at x (/a.js:1:1)', 'ExceptionsHandler');
    logger.fatal(new Error('down'));
    logger.debug('d');
    logger.verbose('v');
    const [first, second, , ,] = out.map((l) => JSON.parse(l));
    expect(first).toMatchObject({ level: 'info', context: 'Bootstrap', message: 'Started', requestId: 'req-12345678' });
    expect(second).toMatchObject({ level: 'warn', context: 'HTTP', message: 'request', status: 404 });
    expect(second.requestId).toBeUndefined();
    expect(out).toHaveLength(4);
    const [error, fatal] = err.map((l) => JSON.parse(l));
    expect(error).toMatchObject({ level: 'error', context: 'ExceptionsHandler', message: 'Boom', stack: 'Error: Boom\n    at x (/a.js:1:1)' });
    expect(fatal).toMatchObject({ level: 'fatal', message: 'down' });
    expect(fatal.stack).toContain('Error: down');
  });
});

describe('ApiErrorCounter', () => {
  class MemoryCounters implements CounterStore {
    rows = new Map<string, Counter>();
    async increment(key: string, windowMs: number, now: number) {
      const row = this.rows.get(key);
      const next = row && row.resetAt > now ? { ...row, count: row.count + 1 } : { count: 1, resetAt: now + windowMs };
      this.rows.set(key, next);
      return next;
    }
    async get(key: string, now: number) {
      const row = this.rows.get(key);
      return row && row.resetAt > now ? row : null;
    }
    async delete(key: string) {
      this.rows.delete(key);
    }
    async sweep() {
      return 0;
    }
  }

  it('counts server errors per hour for the last day', async () => {
    const counter = new ApiErrorCounter(new MemoryCounters());
    const now = Date.parse('2026-10-15T10:30:00Z');
    await counter.record(500, now);
    await counter.record(502, now);
    await counter.record(404, now);
    await counter.record(200, now);
    await counter.record(500, now - 3_600_000);
    await counter.record(500, now - 30 * 3_600_000);
    const hours = await counter.recent(now);
    expect(hours).toHaveLength(24);
    expect(hours[23]).toEqual({ hour: '2026-10-15T10:00:00.000Z', count: 2 });
    expect(hours[22].count).toBe(1);
    expect(hours.reduce((n, h) => n + h.count, 0)).toBe(3);
  });
});
