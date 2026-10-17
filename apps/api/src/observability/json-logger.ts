import type { LoggerService, LogLevel } from '@nestjs/common';
import { requestContext } from './request-context.js';

type Write = (line: string) => void;

/** JSON logs in production (or with LOG_FORMAT=json); LOG_FORMAT=pretty forces Nest's coloured lines. */
export function jsonLogsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const format = env.LOG_FORMAT?.trim().toLowerCase();
  if (format === 'json') return true;
  if (format === 'pretty') return false;
  return env.NODE_ENV === 'production';
}

/**
 * One JSON object per line on stdout (errors on stderr), for log collectors
 * on any host: time, level, context, message, and the request id when the
 * line was written while serving a request. Extra fields can be passed as an
 * object in place of the message (the access log does).
 */
export class JsonLogger implements LoggerService {
  constructor(
    private readonly out: Write = (l) => process.stdout.write(`${l}\n`),
    private readonly err: Write = (l) => process.stderr.write(`${l}\n`),
  ) {}

  log(message: unknown, ...params: unknown[]) {
    this.write('info', message, params);
  }
  error(message: unknown, ...params: unknown[]) {
    this.write('error', message, params);
  }
  warn(message: unknown, ...params: unknown[]) {
    this.write('warn', message, params);
  }
  debug(message: unknown, ...params: unknown[]) {
    this.write('debug', message, params);
  }
  verbose(message: unknown, ...params: unknown[]) {
    this.write('verbose', message, params);
  }
  fatal(message: unknown, ...params: unknown[]) {
    this.write('fatal', message, params);
  }

  /** Nest passes (message, context) or, for errors, (message, stack, context). */
  private write(level: LogLevel | 'info', message: unknown, params: unknown[]) {
    const rest = [...params];
    const context = rest.length && typeof rest[rest.length - 1] === 'string' ? (rest.pop() as string) : undefined;
    const stack = rest.find((p): p is string => typeof p === 'string' && p.includes('\n    at '));
    const ctx = requestContext();
    const entry: Record<string, unknown> = { time: new Date().toISOString(), level, context };
    if (message instanceof Error) Object.assign(entry, { message: message.message, stack: message.stack });
    else if (message && typeof message === 'object') Object.assign(entry, message);
    else entry.message = String(message);
    if (stack && !entry.stack) entry.stack = stack;
    if (ctx && !entry.requestId) entry.requestId = ctx.requestId;
    const line = JSON.stringify(entry);
    (level === 'error' || level === 'fatal' ? this.err : this.out)(line);
  }
}
