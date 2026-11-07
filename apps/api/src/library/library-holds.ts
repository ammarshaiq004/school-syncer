import type { Prisma } from '@prisma/client';
import { dayStart, daysBefore } from '../common/dates.js';

/** Days a returned book waits at the desk for the person who reserved it. */
export const HOLD_DAYS = 3;

export interface Hold {
  id: string;
  /** YYYY-MM-DD. */
  holdUntil: string;
}

/** Holds that were not collected in time (the last day to collect is `holdUntil`). */
export const expiredHolds = (held: Hold[], today: string): string[] => held.filter((h) => h.holdUntil < today).map((h) => h.id);

/**
 * Pairs the queue with copies on the shelf: the earliest reservations get the
 * free copies, and each is held for HOLD_DAYS. `waiting` is in queue order.
 */
export function planHolds(waiting: { id: string }[], freeCopyIds: string[], today: string): { reservationId: string; copyId: string; holdUntil: string }[] {
  return waiting.slice(0, freeCopyIds.length).map((w, i) => ({
    reservationId: w.id,
    copyId: freeCopyIds[i],
    holdUntil: daysBefore(today, -HOLD_DAYS),
  }));
}

type Db = Pick<Prisma.TransactionClient, 'bookReservation' | 'bookCopy'>;

/**
 * Brings a title's reservation queue up to date after a copy came back, was
 * shelved, or a hold ran out: uncollected holds expire, then each free copy
 * that is not already held goes to the next person waiting.
 */
export async function settleHolds(db: Db, bookId: string, today: string) {
  const ready = await db.bookReservation.findMany({ where: { bookId, status: 'READY' }, select: { id: true, copyId: true, holdUntil: true } });
  const expired = new Set(expiredHolds(ready.map((r) => ({ id: r.id, holdUntil: r.holdUntil!.toISOString().slice(0, 10) })), today));
  if (expired.size) {
    await db.bookReservation.updateMany({ where: { id: { in: [...expired] } }, data: { status: 'EXPIRED', copyId: null, settledAt: new Date() } });
  }
  const held = ready.filter((r) => !expired.has(r.id)).map((r) => r.copyId!);
  const waiting = await db.bookReservation.findMany({ where: { bookId, status: 'WAITING' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!waiting.length) return;
  const free = await db.bookCopy.findMany({ where: { bookId, status: 'AVAILABLE', id: { notIn: held } }, select: { id: true }, take: waiting.length });
  for (const h of planHolds(waiting, free.map((c) => c.id), today)) {
    await db.bookReservation.update({
      where: { id: h.reservationId },
      data: { status: 'READY', copyId: h.copyId, holdUntil: dayStart(h.holdUntil) },
    });
  }
}
