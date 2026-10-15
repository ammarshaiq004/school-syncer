import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { currentRequestId } from './request-context.js';
import { scrub, scrubText } from './scrub.js';

/** Where events go, parsed from a Sentry DSN: https://<key>@<host>[/<path>]/<project>. */
export interface Dsn {
  envelopeUrl: string;
  publicKey: string;
  raw: string;
}

/** Parses a Sentry (or GlitchTip) DSN; null when it is empty or malformed. */
export function parseDsn(value: string | undefined): Dsn | null {
  const raw = value?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const segments = url.pathname.split('/').filter(Boolean);
  const project = segments.pop();
  if (!url.username || !project || !/^https?:$/.test(url.protocol)) return null;
  const base = `${url.protocol}//${url.host}${segments.length ? `/${segments.join('/')}` : ''}`;
  return { envelopeUrl: `${base}/api/${project}/envelope/`, publicKey: decodeURIComponent(url.username), raw };
}

export interface StackFrame {
  function?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
}

/** V8 stack lines as Sentry frames, oldest call first (Sentry's order). */
export function parseStack(stack: string | undefined): StackFrame[] {
  if (!stack) return [];
  const frames: StackFrame[] = [];
  for (const line of stack.split('\n').slice(1, 51)) {
    const m = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line);
    if (!m) continue;
    const filename = m[2].replace(/^file:\/\//, '');
    frames.push({
      function: m[1] || '<anonymous>',
      filename,
      lineno: Number(m[3]),
      colno: Number(m[4]),
      in_app: !filename.includes('node_modules') && !filename.startsWith('node:'),
    });
  }
  return frames.reverse();
}

export interface ReportContext {
  level?: 'fatal' | 'error' | 'warning' | 'info';
  requestId?: string;
  request?: { method?: string; url?: string; headers?: Record<string, unknown>; data?: unknown };
  /** Ids only: never names, phones or emails. */
  user?: { id?: string; schoolId?: string };
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

/** At most this many events a minute leave one process, so an error storm cannot flood the tracker. */
const MAX_EVENTS_PER_MINUTE = 30;

/**
 * Sends errors to Sentry or a self-hosted GlitchTip over the envelope API,
 * without an SDK. Off unless SENTRY_DSN is set. Every event is scrubbed
 * (see scrub.ts) and carries the request id, so a report can be matched to
 * the API's logs and to what the user saw. Sending never throws and never
 * delays the response: failures are logged once a minute at most.
 */
export class ErrorReporter {
  private readonly logger = new Logger('ErrorReporter');
  private window = { start: 0, count: 0 };
  private lastWarning = 0;

  constructor(
    readonly dsn: Dsn | null,
    private readonly options: { environment?: string; release?: string; fetch?: Fetch; now?: () => number } = {},
  ) {}

  static fromEnv(env: Record<string, string | undefined> = process.env): ErrorReporter {
    return new ErrorReporter(parseDsn(env.SENTRY_DSN), {
      environment: env.SENTRY_ENVIRONMENT || env.NODE_ENV || 'development',
      release: env.SENTRY_RELEASE || undefined,
    });
  }

  get enabled() {
    return this.dsn !== null;
  }

  /** The event Sentry receives for this error, already scrubbed. */
  buildEvent(error: unknown, ctx: ReportContext = {}): Record<string, unknown> {
    const err = error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Non-error thrown');
    const requestId = ctx.requestId ?? currentRequestId();
    const event = {
      event_id: randomUUID().replace(/-/g, ''),
      timestamp: (this.options.now?.() ?? Date.now()) / 1000,
      platform: 'node',
      level: ctx.level ?? 'error',
      logger: 'api',
      server_name: hostname(),
      environment: this.options.environment,
      release: this.options.release,
      exception: { values: [{ type: err.name, value: err.message, stacktrace: { frames: parseStack(err.stack) } }] },
      tags: ctx.tags,
      request: ctx.request,
      user: ctx.user?.id ? { id: ctx.user.id } : undefined,
      contexts: ctx.user?.schoolId ? { school: { id: ctx.user.schoolId } } : undefined,
      extra: ctx.extra,
    };
    const clean = scrub(event) as Record<string, unknown>;
    // Added after scrubbing: an id is not personal data, and a UUID's digits could look like a number.
    if (requestId) clean.tags = { ...(clean.tags as object), request_id: requestId };
    return clean;
  }

  /** Reports an error; resolves to the event id, or null when off, rate-limited or not delivered. */
  async captureException(error: unknown, ctx: ReportContext = {}): Promise<string | null> {
    if (!this.dsn || !this.allow()) return null;
    try {
      return await this.send(this.buildEvent(error, ctx));
    } catch (e) {
      this.warn(`Could not build the error report: ${(e as Error).message}`);
      return null;
    }
  }

  /** Reports a message without an exception (e.g. an alert worth tracking). */
  async captureMessage(message: string, ctx: ReportContext = {}): Promise<string | null> {
    if (!this.dsn || !this.allow()) return null;
    const event = this.buildEvent(new Error(message), ctx);
    delete event.exception;
    event.message = { formatted: scrubText(message) };
    return this.send(event);
  }

  private allow() {
    const now = this.options.now?.() ?? Date.now();
    if (now - this.window.start >= 60_000) this.window = { start: now, count: 0 };
    return ++this.window.count <= MAX_EVENTS_PER_MINUTE;
  }

  private async send(event: Record<string, unknown>): Promise<string | null> {
    const dsn = this.dsn!;
    const id = event.event_id as string;
    const body = [JSON.stringify({ event_id: id, sent_at: new Date().toISOString(), dsn: dsn.raw }), JSON.stringify({ type: 'event' }), JSON.stringify(event)].join('\n');
    try {
      const res = await (this.options.fetch ?? (fetch as unknown as Fetch))(dsn.envelopeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-sentry-envelope',
          'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=schoolsyncer-api/1.0, sentry_key=${dsn.publicKey}`,
        },
        body,
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return id;
    } catch (e) {
      this.warn(`Error report not delivered: ${(e as Error).message}`);
      return null;
    }
  }

  private warn(message: string) {
    const now = Date.now();
    if (now - this.lastWarning < 60_000) return;
    this.lastWarning = now;
    this.logger.warn(message);
  }
}

let shared: ErrorReporter | null = null;

/** The process-wide reporter, configured from the environment on first use. */
export function errorReporter(): ErrorReporter {
  return (shared ??= ErrorReporter.fromEnv());
}

/** For tests: replaces (or with null, resets) the process-wide reporter. */
export function setErrorReporter(reporter: ErrorReporter | null) {
  shared = reporter;
}
