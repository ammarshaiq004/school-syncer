import type { ArgumentsHost } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { mapPrismaError, PrismaExceptionFilter } from './prisma-exception.filter.js';

const known = (code: string) =>
  new Prisma.PrismaClientKnownRequestError(`Invalid \`prisma.student.create()\` invocation: SELECT * FROM "Student"`, {
    code,
    clientVersion: '6.19.3',
    meta: { target: ['schoolId', 'admissionNo'] },
  });

describe('mapPrismaError', () => {
  it.each([
    ['P2002', 409],
    ['P2003', 409],
    ['P2025', 404],
    ['P2034', 409],
    ['P2000', 400],
    ['P2023', 400],
  ])('maps %s to %i', (code, status) => {
    expect(mapPrismaError(known(code)).status).toBe(status);
  });

  it('asks the caller to retry a serialization failure', () => {
    expect(mapPrismaError(known('P2034')).body.message).toContain('try again');
  });

  it('answers 400 for a query built from bad input', () => {
    const e = new Prisma.PrismaClientValidationError('Invalid value for argument `status`. Expected InvoiceStatus.', {
      clientVersion: '6.19.3',
    });
    expect(mapPrismaError(e)).toEqual({
      status: 400,
      body: { statusCode: 400, message: 'Invalid value in the request', error: 'Bad Request' },
    });
  });

  it('keeps other database errors a plain 500', () => {
    expect(mapPrismaError(known('P1001'))).toEqual({
      status: 500,
      body: { statusCode: 500, message: 'Internal server error', error: 'Internal Server Error' },
    });
  });
});

describe('PrismaExceptionFilter', () => {
  it('sends the mapped answer without the query, values or stack', () => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const host = { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;
    new PrismaExceptionFilter().catch(known('P2002'), host);
    expect(res.status).toHaveBeenCalledWith(409);
    const body = res.json.mock.calls[0][0];
    expect(body).toEqual({ statusCode: 409, message: 'A record with these details already exists', error: 'Conflict' });
    expect(JSON.stringify(body)).not.toMatch(/SELECT|prisma|admissionNo|at /);
  });
});
