import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

/** What every log line and error report of one request shares. */
export interface RequestContext {
  requestId: string;
  method?: string;
  path?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** The current request's context, or undefined outside a request (jobs, boot). */
export const requestContext = (): RequestContext | undefined => storage.getStore();

/** The current request's id, or undefined outside a request. */
export const currentRequestId = (): string | undefined => storage.getStore()?.requestId;

/** Runs `fn` with this context, e.g. a job under its own id. */
export const withRequestContext = <T>(context: RequestContext, fn: () => T): T => storage.run(context, fn);

/**
 * An incoming X-Request-Id is kept when it looks like an id (a proxy or the
 * web app set it, so their logs line up with ours); anything else, including
 * an attempt to inject text into the logs, gets a fresh UUID.
 */
export function requestIdFrom(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  return value && /^[A-Za-z0-9._:-]{8,128}$/.test(value) ? value : randomUUID();
}

/**
 * Express middleware, first in the chain: gives the request its id, echoes it
 * in the X-Request-Id response header, and runs the rest of the request
 * inside its context. `onFinish` sees every completed request (access log,
 * error counts).
 */
export function requestIdMiddleware(onFinish?: (req: Request, res: Response, ms: number, ctx: RequestContext) => void) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ctx: RequestContext = { requestId: requestIdFrom(req.headers[REQUEST_ID_HEADER]), method: req.method, path: req.originalUrl?.split('?')[0] };
    res.setHeader('X-Request-Id', ctx.requestId);
    const started = process.hrtime.bigint();
    if (onFinish) res.on('finish', () => onFinish(req, res, Number(process.hrtime.bigint() - started) / 1e6, ctx));
    storage.run(ctx, next);
  };
}
