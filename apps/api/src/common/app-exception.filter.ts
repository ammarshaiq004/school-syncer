import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { errorReporter, type ErrorReporter } from '../observability/error-reporter.js';
import { currentRequestId } from '../observability/request-context.js';
import { mapPrismaError } from './prisma-exception.filter.js';

interface Answer {
  status: number;
  body: Record<string, unknown>;
  /** Worth an error report: a bug or an outage, not a refusal. */
  report: boolean;
}

/** Errors from libraries that carry their own HTTP status (body-parser's 413, for instance). */
const httpLike = (e: unknown): e is { statusCode: number; message: string } =>
  typeof e === 'object' && e !== null && typeof (e as { statusCode?: unknown }).statusCode === 'number' && typeof (e as { message?: unknown }).message === 'string';

/** What the caller is told for an exception. Messages never include queries, values or stacks. */
export function answerFor(exception: unknown): Answer {
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const response = exception.getResponse();
    const body = typeof response === 'string' ? { statusCode: status, message: response } : { ...(response as Record<string, unknown>) };
    // A deliberate 503 (health checks) is an answer, not a crash.
    return { status, body, report: status >= 500 && status !== HttpStatus.SERVICE_UNAVAILABLE };
  }
  if (exception instanceof Prisma.PrismaClientKnownRequestError || exception instanceof Prisma.PrismaClientValidationError) {
    const { status, body } = mapPrismaError(exception);
    return { status, body: { ...body }, report: status >= 500 };
  }
  if (httpLike(exception) && exception.statusCode >= 400 && exception.statusCode < 600) {
    return { status: exception.statusCode, body: { statusCode: exception.statusCode, message: exception.message }, report: exception.statusCode >= 500 };
  }
  const status = HttpStatus.INTERNAL_SERVER_ERROR;
  return { status, body: { statusCode: status, message: 'Internal server error' }, report: true };
}

/**
 * The API's one exception filter. Answers like Nest's default handler, with
 * database errors turned into 409/404/400 instead of 500s (see
 * mapPrismaError), and adds the request id to every error body so a user's
 * screenshot leads straight to the logs. Server errors are logged with
 * their stack and sent to the error tracker when SENTRY_DSN is set.
 */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionsHandler');
  private readonly prismaLogger = new Logger('PrismaException');

  constructor(private readonly reporter: ErrorReporter = errorReporter()) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const req = http.getRequest<Request & { user?: { sub?: string; schoolId?: string } }>();
    const res = http.getResponse<Response>();
    const { status, body, report } = answerFor(exception);
    const requestId = currentRequestId() ?? (res.getHeader?.('X-Request-Id') as string | undefined);
    this.log(exception, status);
    if (report) {
      void this.reporter.captureException(exception, {
        requestId,
        request: { method: req?.method, url: req?.originalUrl, headers: { 'user-agent': req?.headers?.['user-agent'] } },
        user: { id: req?.user?.sub, schoolId: req?.user?.schoolId },
        // Only which fields were sent: values may name children or carry secrets.
        extra: req?.body && typeof req.body === 'object' ? { bodyFields: Object.keys(req.body).slice(0, 50) } : undefined,
      });
    }
    if (res.headersSent) return;
    res.status(status).json(requestId ? { ...body, requestId } : body);
  }

  private log(exception: unknown, status: number) {
    if (exception instanceof Prisma.PrismaClientKnownRequestError || exception instanceof Prisma.PrismaClientValidationError) {
      const code = exception instanceof Prisma.PrismaClientKnownRequestError ? exception.code : 'validation';
      if (status >= 500) this.prismaLogger.error(`Unhandled database error (${code})`, exception.stack);
      else this.prismaLogger.warn(`Database error ${code} answered with ${status}`);
    } else if (!(exception instanceof HttpException) && status >= 500) {
      const e = exception instanceof Error ? exception : new Error(String(exception));
      this.logger.error(e.message, e.stack);
    }
  }
}
