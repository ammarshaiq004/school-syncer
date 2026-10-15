import { type ArgumentsHost, BadRequestException, HttpException, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ErrorReporter } from '../observability/error-reporter.js';
import { withRequestContext } from '../observability/request-context.js';
import { AppExceptionFilter, answerFor } from './app-exception.filter.js';

const known = (code: string) =>
  new Prisma.PrismaClientKnownRequestError(`Invalid \`prisma.student.create()\` invocation: SELECT * FROM "Student"`, {
    code,
    clientVersion: '6.19.3',
    meta: { target: ['schoolId', 'admissionNo'] },
  });

function harness() {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), headersSent: false, getHeader: vi.fn() };
  const req = {
    method: 'POST',
    originalUrl: '/api/students?token=abc',
    headers: { 'user-agent': 'vitest' },
    body: { password: 'x', name: 'Ali' },
    user: { sub: 'u1', schoolId: 's1' },
  };
  const host = { switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }) } as unknown as ArgumentsHost;
  const reporter = new ErrorReporter(null);
  const capture = vi.spyOn(reporter, 'captureException');
  return { res, host, capture, filter: new AppExceptionFilter(reporter) };
}

describe('answerFor', () => {
  it('keeps HttpException bodies as Nest sends them', () => {
    expect(answerFor(new NotFoundException())).toMatchObject({ status: 404, body: { statusCode: 404, message: 'Not Found' }, report: false });
    expect(answerFor(new HttpException('Nope', 418)).body).toEqual({ statusCode: 418, message: 'Nope' });
    expect(answerFor(new BadRequestException({ message: 'Invalid', issues: [{ path: 'a', message: 'b' }] })).body).toHaveProperty('issues');
  });

  it('reports server errors but not a deliberate 503', () => {
    expect(answerFor(new HttpException('Boom', 500)).report).toBe(true);
    expect(answerFor(new HttpException({ status: 'error' }, 503)).report).toBe(false);
  });

  it('keeps the status of library errors that carry one (e.g. a body too large)', () => {
    const tooLarge = Object.assign(new Error('request entity too large'), { statusCode: 413 });
    expect(answerFor(tooLarge)).toEqual({ status: 413, body: { statusCode: 413, message: 'request entity too large' }, report: false });
  });

  it('hides the details of unknown errors', () => {
    expect(answerFor(new Error('connect ECONNREFUSED 10.0.0.5:5432'))).toEqual({
      status: 500,
      body: { statusCode: 500, message: 'Internal server error' },
      report: true,
    });
  });
});

describe('AppExceptionFilter', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('sends the mapped database answer without the query, values or stack', () => {
    const { res, host, filter, capture } = harness();
    filter.catch(known('P2002'), host);
    expect(res.status).toHaveBeenCalledWith(409);
    const body = res.json.mock.calls[0][0];
    expect(body).toEqual({ statusCode: 409, message: 'A record with these details already exists', error: 'Conflict' });
    expect(JSON.stringify(body)).not.toMatch(/SELECT|prisma|admissionNo|at /);
    expect(capture).not.toHaveBeenCalled();
  });

  it('reports a database error it cannot map', () => {
    const { res, host, filter, capture } = harness();
    filter.catch(known('P1001'), host);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(capture).toHaveBeenCalledOnce();
  });

  it('adds the request id to error bodies and reports crashes with it', () => {
    const { res, host, filter, capture } = harness();
    withRequestContext({ requestId: 'req-12345678' }, () => filter.catch(new TypeError('x is undefined'), host));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ statusCode: 500, message: 'Internal server error', requestId: 'req-12345678' });
    const ctx = capture.mock.calls[0][1]!;
    expect(ctx).toMatchObject({ requestId: 'req-12345678', user: { id: 'u1', schoolId: 's1' }, extra: { bodyFields: ['password', 'name'] } });
  });

  it('does not write twice when the response already started', () => {
    const { res, host, filter } = harness();
    res.headersSent = true;
    filter.catch(new Error('late'), host);
    expect(res.json).not.toHaveBeenCalled();
  });
});
