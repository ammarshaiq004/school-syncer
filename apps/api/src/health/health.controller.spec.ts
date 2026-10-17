import { HttpException, Logger } from '@nestjs/common';
import type { JobsService } from '../jobs/jobs.service.js';
import { SystemHealthService } from '../monitoring/system-health.service.js';
import type { ApiErrorCounter } from '../observability/api-errors.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { HealthController } from './health.controller.js';

const controller = (queryRaw: () => Promise<unknown>) =>
  new HealthController(
    new SystemHealthService({ $queryRaw: queryRaw } as unknown as PrismaService, {} as ApiErrorCounter, {} as JobsService),
  );

describe('HealthController', () => {
  beforeEach(() => vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined));
  afterEach(() => vi.restoreAllMocks());

  it('is ok when the database answers', async () => {
    await expect(controller(async () => [{ '?column?': 1 }]).check()).resolves.toEqual({ status: 'ok' });
  });

  it('answers 503 when the database is unreachable', async () => {
    const error = await controller(async () => {
      throw new Error("Can't reach database server at `db:5432`");
    })
      .check()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(503);
    // No connection details in the response.
    expect((error as HttpException).getResponse()).toEqual({ status: 'error', database: 'down' });
  });

  it('is not ready while the database is unreachable, and skips the other checks', async () => {
    const error = await controller(async () => {
      throw new Error('down');
    })
      .ready()
      .catch((e: unknown) => e);
    expect((error as HttpException).getStatus()).toBe(503);
    expect((error as HttpException).getResponse()).toEqual({
      status: 'error',
      checks: { database: { ok: false, detail: 'The database does not answer' } },
    });
  });
});
