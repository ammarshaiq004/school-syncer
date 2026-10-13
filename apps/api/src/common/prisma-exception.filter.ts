import { type ArgumentsHost, Catch, type ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

/** What a database error means for the caller. Messages never include the query, values or stack. */
const KNOWN: Record<string, { status: HttpStatus; message: string }> = {
  // Unique constraint
  P2002: { status: HttpStatus.CONFLICT, message: 'A record with these details already exists' },
  // Foreign key: refers to something missing, or something still refers to it
  P2003: { status: HttpStatus.CONFLICT, message: 'This refers to a record that does not exist, or other records still depend on it' },
  // Record to update or delete not found
  P2025: { status: HttpStatus.NOT_FOUND, message: 'Not found' },
  // Serialization failure or deadlock under concurrent changes
  P2034: { status: HttpStatus.CONFLICT, message: 'Someone else changed this at the same time. Please try again.' },
  // Value too long for its column
  P2000: { status: HttpStatus.BAD_REQUEST, message: 'A value is too long' },
  // Malformed value for the column type, e.g. an id that is not an id
  P2023: { status: HttpStatus.BAD_REQUEST, message: 'Invalid value in the request' },
};

export interface MappedError {
  status: HttpStatus;
  body: { statusCode: number; message: string; error: string };
}

const ERROR_NAMES: Partial<Record<HttpStatus, string>> = {
  [HttpStatus.BAD_REQUEST]: 'Bad Request',
  [HttpStatus.NOT_FOUND]: 'Not Found',
  [HttpStatus.CONFLICT]: 'Conflict',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'Internal Server Error',
};

/** The HTTP answer for a Prisma error. Unmapped errors stay a plain 500. */
export function mapPrismaError(exception: unknown): MappedError {
  let status = HttpStatus.INTERNAL_SERVER_ERROR;
  let message = 'Internal server error';
  if (exception instanceof Prisma.PrismaClientKnownRequestError && KNOWN[exception.code]) {
    ({ status, message } = KNOWN[exception.code]);
  } else if (exception instanceof Prisma.PrismaClientValidationError) {
    // A query built from bad input (e.g. an unknown enum value in a filter).
    status = HttpStatus.BAD_REQUEST;
    message = 'Invalid value in the request';
  }
  return { status, body: { statusCode: status, message, error: ERROR_NAMES[status] ?? 'Error' } };
}

/**
 * Turns database errors that escape a handler into proper HTTP answers (409,
 * 404, 400) instead of 500s, without leaking SQL or stack traces. Other
 * exceptions, HttpExceptions included, keep Nest's default handling.
 */
@Catch(Prisma.PrismaClientKnownRequestError, Prisma.PrismaClientValidationError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('PrismaException');

  catch(exception: Prisma.PrismaClientKnownRequestError | Prisma.PrismaClientValidationError, host: ArgumentsHost) {
    const { status, body } = mapPrismaError(exception);
    const code = exception instanceof Prisma.PrismaClientKnownRequestError ? exception.code : 'validation';
    if (status >= 500) this.logger.error(`Unhandled database error (${code})`, exception.stack);
    else this.logger.warn(`Database error ${code} answered with ${status}`);
    const res = host.switchToHttp().getResponse<Response>();
    res.status(status).json(body);
  }
}
