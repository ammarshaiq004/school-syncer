import { Logger } from '@nestjs/common';
import { ErrorReporter, errorReporter, parseDsn, parseStack, setErrorReporter } from './error-reporter.js';
import { withRequestContext } from './request-context.js';

describe('parseDsn', () => {
  it('reads Sentry and self-hosted GlitchTip DSNs', () => {
    expect(parseDsn('https://abc123@o1.ingest.sentry.io/42')).toMatchObject({ envelopeUrl: 'https://o1.ingest.sentry.io/api/42/envelope/', publicKey: 'abc123' });
    expect(parseDsn('http://key@glitchtip.local:8000/sub/path/7')).toMatchObject({ envelopeUrl: 'http://glitchtip.local:8000/sub/path/api/7/envelope/' });
  });

  it('refuses empty or malformed values', () => {
    for (const v of [undefined, '', '  ', 'not a dsn', 'https://o1.ingest.sentry.io/42', 'https://key@host/', 'ftp://key@host/1']) {
      expect(parseDsn(v)).toBeNull();
    }
  });
});

describe('parseStack', () => {
  it('turns V8 lines into frames, oldest call first', () => {
    const stack = [
      'Error: boom',
      '    at StudentsService.create (/app/dist/students/students.service.js:10:5)',
      '    at /app/node_modules/@nestjs/core/router.js:3:1',
      '    at node:internal/process/task_queues:95:5',
      'not a frame',
    ].join('\n');
    const frames = parseStack(stack);
    expect(frames).toHaveLength(3);
    expect(frames[2]).toEqual({ function: 'StudentsService.create', filename: '/app/dist/students/students.service.js', lineno: 10, colno: 5, in_app: true });
    expect(frames[1]).toMatchObject({ function: '<anonymous>', in_app: false });
    expect(frames[0]).toMatchObject({ in_app: false });
    expect(parseStack(undefined)).toEqual([]);
  });
});

describe('ErrorReporter', () => {
  const dsn = parseDsn('https://pub@tracker.example.pk/3');
  const sent: { url: string; headers: Record<string, string>; body: string }[] = [];
  const fetch = vi.fn(async (url: string, init: { headers: Record<string, string>; body: string }) => {
    sent.push({ url, headers: init.headers, body: init.body });
    return { ok: true, status: 200 };
  });

  beforeEach(() => {
    sent.length = 0;
    fetch.mockClear();
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('does nothing without a DSN', async () => {
    const off = new ErrorReporter(null, { fetch });
    expect(off.enabled).toBe(false);
    await expect(off.captureException(new Error('x'))).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends a scrubbed envelope tagged with the request id', async () => {
    const reporter = new ErrorReporter(dsn, { fetch, environment: 'production', release: '1.2.3' });
    const error = new Error('Guardian 35202-1234567-1 with phone 03001234567 failed: password=hunter22');
    const id = await withRequestContext({ requestId: 'req-abcdef12' }, () =>
      reporter.captureException(error, {
        request: { method: 'POST', url: '/api/auth/login?token=abc', headers: { authorization: 'Bearer abc', cookie: 'sid=1' }, data: { password: 'p', email: 'a@b.pk' } },
        user: { id: 'u1', schoolId: 's1' },
        extra: { secrets: { hashKey: 'k' } },
      }),
    );
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('https://tracker.example.pk/api/3/envelope/');
    expect(sent[0].headers['X-Sentry-Auth']).toContain('sentry_key=pub');
    const [header, item, eventLine] = sent[0].body.split('\n');
    expect(JSON.parse(header)).toMatchObject({ event_id: id });
    expect(JSON.parse(item)).toEqual({ type: 'event' });
    const event = JSON.parse(eventLine);
    expect(event).toMatchObject({ level: 'error', environment: 'production', release: '1.2.3', user: { id: 'u1' }, contexts: { school: { id: 's1' } }, tags: { request_id: 'req-abcdef12' } });
    const text = JSON.stringify(event);
    for (const leak of ['35202-1234567-1', '03001234567', 'hunter22', 'Bearer abc', 'sid=1', 'token=abc', '"p"', 'a@b.pk', '"k"']) {
      expect(text).not.toContain(leak);
    }
    expect(event.exception.values[0].value).toBe('Guardian [cnic] with phone [phone] failed: password=[redacted]');
  });

  it('reports messages and non-errors', async () => {
    const reporter = new ErrorReporter(dsn, { fetch });
    await reporter.captureMessage('Alert: call 03001234567', { level: 'warning' });
    const event = JSON.parse(sent[0].body.split('\n')[2]);
    expect(event.exception).toBeUndefined();
    expect(event.message).toEqual({ formatted: 'Alert: call [phone]' });
    expect(reporter.buildEvent('a string').exception).toMatchObject({ values: [{ value: 'a string' }] });
    expect(reporter.buildEvent(42).exception).toMatchObject({ values: [{ value: 'Non-error thrown' }] });
  });

  it('never throws when the tracker is down, and limits a storm', async () => {
    let now = 1_000_000;
    const failing = new ErrorReporter(dsn, { fetch: async () => ({ ok: false, status: 502 }), now: () => now });
    await expect(failing.captureException(new Error('x'))).resolves.toBeNull();
    const down = new ErrorReporter(dsn, { fetch: () => Promise.reject(new Error('ECONNREFUSED')) });
    await expect(down.captureException(new Error('x'))).resolves.toBeNull();

    const reporter = new ErrorReporter(dsn, { fetch, now: () => now });
    for (let i = 0; i < 40; i++) await reporter.captureException(new Error(`e${i}`));
    expect(fetch).toHaveBeenCalledTimes(30);
    now += 60_000;
    await reporter.captureException(new Error('next minute'));
    expect(fetch).toHaveBeenCalledTimes(31);
  });

  it('is configured once per process from the environment', () => {
    setErrorReporter(null);
    const shared = errorReporter();
    expect(errorReporter()).toBe(shared);
    expect(ErrorReporter.fromEnv({ SENTRY_DSN: 'https://k@h.pk/1' }).enabled).toBe(true);
    expect(ErrorReporter.fromEnv({}).enabled).toBe(false);
    setErrorReporter(null);
  });
});
