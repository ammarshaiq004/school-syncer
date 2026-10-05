import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * Runs `fn` in a SERIALIZABLE transaction, for read-check-write rules such as
 * "keep at least one active owner": two concurrent demotions cannot both pass
 * the count. Postgres aborts one of them (P2034), answered as 409.
 */
export async function serializable<T>(
  prisma: PrismaService,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  try {
    return await prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') {
      throw new ConflictException('Someone else changed this at the same time. Try again.');
    }
    throw e;
  }
}
