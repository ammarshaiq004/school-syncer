import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Prisma 7 connects through a driver adapter: node-postgres, using
 * DATABASE_URL. PrismaService and the command-line scripts share this.
 */
export function prismaAdapter(): PrismaPg {
  return new PrismaPg({ connectionString: process.env.DATABASE_URL });
}

/**
 * A client for the command-line scripts (seed, create-admin, data fixes).
 * Prisma 7 no longer reads .env, so load apps/api/.env first when there is
 * one; variables already set win.
 */
export function createScriptPrismaClient(): PrismaClient {
  try {
    process.loadEnvFile();
  } catch {
    // No .env here: the environment has them (a container, a CI job).
  }
  return new PrismaClient({ adapter: prismaAdapter() });
}

/**
 * Prisma 7 reports a serialization failure or deadlock that Postgres raises
 * at COMMIT as the adapter's raw DriverAdapterError, while the same failure
 * on a query inside the transaction is a P2034. Gives the first the P2034
 * code that the retry helpers and the exception filter handle; any other
 * error is returned as it is.
 */
export function asWriteConflict(error: unknown): unknown {
  const cause = error instanceof Error && error.name === 'DriverAdapterError' ? (error.cause as { kind?: unknown }) : undefined;
  if (cause?.kind !== 'TransactionWriteConflict') return error;
  return new Prisma.PrismaClientKnownRequestError('Transaction failed due to a write conflict or a deadlock. Please retry your transaction', {
    code: 'P2034',
    clientVersion: Prisma.prismaVersion.client,
  });
}
