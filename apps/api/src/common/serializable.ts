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

/**
 * Runs `fn` again when Postgres gave up on it because of a concurrent write:
 * a serialization failure or deadlock (P2034), or, when listed in `codes`, a
 * racing insert that hit a unique key (P2002). The aborted attempt saved
 * nothing. The last failure is rethrown as it came; the exception filter
 * answers both codes with 409.
 */
export async function retryOnConflict<T>(
  fn: () => Promise<T>,
  { attempts = 4, codes = ['P2034'] }: { attempts?: number; codes?: string[] } = {},
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const retry = e instanceof Prisma.PrismaClientKnownRequestError && codes.includes(e.code);
      if (!retry || attempt >= attempts) throw e;
    }
  }
}
