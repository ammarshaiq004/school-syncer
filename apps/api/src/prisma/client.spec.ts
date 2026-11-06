import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { asWriteConflict, prismaAdapter } from './client.js';

/** What @prisma/adapter-pg throws: an Error named DriverAdapterError with the kind in `cause`. */
const adapterError = (kind: string) => Object.assign(new Error(kind), { name: 'DriverAdapterError', cause: { kind } });

describe('asWriteConflict', () => {
  it('turns a write conflict raised at commit into a P2034', () => {
    const mapped = asWriteConflict(adapterError('TransactionWriteConflict'));
    expect(mapped).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(mapped).toMatchObject({ code: 'P2034' });
  });

  it('passes every other error through unchanged', () => {
    const other = adapterError('UniqueConstraintViolation');
    expect(asWriteConflict(other)).toBe(other);
    const plain = new Error('boom');
    expect(asWriteConflict(plain)).toBe(plain);
    expect(asWriteConflict('not an error')).toBe('not an error');
  });
});

describe('prismaAdapter', () => {
  it('connects to Postgres', () => {
    expect(prismaAdapter().provider).toBe('postgres');
  });
});
