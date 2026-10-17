import { Global, Logger, type MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiErrorCounter } from './api-errors.js';
import { ErrorReporter, errorReporter } from './error-reporter.js';
import { jsonLogsEnabled } from './json-logger.js';
import { type RequestContext, requestIdMiddleware } from './request-context.js';

/** Request ids, the access log, server-error counts and the error tracker. */
@Global()
@Module({
  providers: [ApiErrorCounter, { provide: ErrorReporter, useFactory: errorReporter }],
  exports: [ApiErrorCounter, ErrorReporter],
})
export class ObservabilityModule implements NestModule {
  private readonly logger = new Logger('HTTP');
  private readonly accessLog = jsonLogsEnabled();

  constructor(private readonly errors: ApiErrorCounter) {}

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(requestIdMiddleware((req, res, ms, ctx) => this.finished(req, res, ms, ctx))).forRoutes({ path: '*path', method: RequestMethod.ALL });
  }

  private finished(_req: Request, res: Response, ms: number, ctx: RequestContext) {
    const health = ctx.path?.startsWith('/api/health');
    // Health checks answer 503 on purpose when something is down; that is not an API error.
    if (!health) void this.errors.record(res.statusCode).catch(() => undefined);
    if (this.accessLog && (!health || res.statusCode >= 400)) {
      this.logger.log({ message: 'request', requestId: ctx.requestId, method: ctx.method, path: ctx.path, status: res.statusCode, ms: Math.round(ms) });
    }
  }
}
