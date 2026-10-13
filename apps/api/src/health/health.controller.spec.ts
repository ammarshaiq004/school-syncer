import { HttpException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import { HealthController } from './health.controller.js';

const controller = (queryRaw: () => Promise<unknown>) =>
  new HealthController({ $queryRaw: queryRaw } as unknown as PrismaService);

describe('HealthController', () => {
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
});
