import { expiredHolds, HOLD_DAYS, planHolds, settleHolds } from './library-holds.js';

describe('expiredHolds', () => {
  it('expires a hold the day after its last day', () => {
    const held = [
      { id: 'a', holdUntil: '2026-11-04' },
      { id: 'b', holdUntil: '2026-11-05' },
    ];
    expect(expiredHolds(held, '2026-11-05')).toEqual(['a']);
  });
});

describe('planHolds', () => {
  it('gives free copies to the earliest in the queue and holds them for the hold period', () => {
    const plan = planHolds([{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }], ['c1', 'c2'], '2026-11-05');
    expect(plan).toEqual([
      { reservationId: 'r1', copyId: 'c1', holdUntil: '2026-11-08' },
      { reservationId: 'r2', copyId: 'c2', holdUntil: '2026-11-08' },
    ]);
    expect(HOLD_DAYS).toBe(3);
  });

  it('plans nothing without waiting people or free copies', () => {
    expect(planHolds([], ['c1'], '2026-11-05')).toEqual([]);
    expect(planHolds([{ id: 'r1' }], [], '2026-11-05')).toEqual([]);
  });
});

/** A tiny in-memory stand-in for the two tables settleHolds touches. */
function fakeDb(
  reservations: { id: string; bookId: string; status: string; copyId: string | null; holdUntil: Date | null; createdAt: Date }[],
  copies: { id: string; bookId: string; status: string }[],
) {
  return {
    reservations,
    bookReservation: {
      findMany: async ({ where }: { where: { bookId: string; status: string } }) =>
        reservations.filter((r) => r.bookId === where.bookId && r.status === where.status).sort((a, b) => +a.createdAt - +b.createdAt),
      updateMany: async ({ where, data }: { where: { id: { in: string[] } }; data: object }) => {
        for (const r of reservations) if (where.id.in.includes(r.id)) Object.assign(r, data);
      },
      update: async ({ where, data }: { where: { id: string }; data: object }) => {
        Object.assign(reservations.find((r) => r.id === where.id)!, data);
      },
    },
    bookCopy: {
      findMany: async ({ where, take }: { where: { bookId: string; status: string; id: { notIn: string[] } }; take: number }) =>
        copies.filter((c) => c.bookId === where.bookId && c.status === where.status && !where.id.notIn.includes(c.id)).slice(0, take),
    },
  };
}

describe('settleHolds', () => {
  const at = (n: number) => new Date(2026, 10, n);
  const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  it('holds a returned copy for the first person waiting', async () => {
    const db = fakeDb(
      [
        { id: 'r1', bookId: 'b', status: 'WAITING', copyId: null, holdUntil: null, createdAt: at(1) },
        { id: 'r2', bookId: 'b', status: 'WAITING', copyId: null, holdUntil: null, createdAt: at(2) },
      ],
      [{ id: 'c1', bookId: 'b', status: 'AVAILABLE' }],
    );
    await settleHolds(db as never, 'b', '2026-11-05');
    expect(db.reservations[0]).toMatchObject({ status: 'READY', copyId: 'c1' });
    expect(db.reservations[0].holdUntil?.toISOString().slice(0, 10)).toBe('2026-11-08');
    expect(db.reservations[1].status).toBe('WAITING');
  });

  it('does not hand out a copy that is already held', async () => {
    const db = fakeDb(
      [
        { id: 'r1', bookId: 'b', status: 'READY', copyId: 'c1', holdUntil: day('2026-11-06'), createdAt: at(1) },
        { id: 'r2', bookId: 'b', status: 'WAITING', copyId: null, holdUntil: null, createdAt: at(2) },
      ],
      [{ id: 'c1', bookId: 'b', status: 'AVAILABLE' }],
    );
    await settleHolds(db as never, 'b', '2026-11-05');
    expect(db.reservations.map((r) => r.status)).toEqual(['READY', 'WAITING']);
  });

  it('expires an uncollected hold and passes the copy to the next in line', async () => {
    const db = fakeDb(
      [
        { id: 'r1', bookId: 'b', status: 'READY', copyId: 'c1', holdUntil: day('2026-11-04'), createdAt: at(1) },
        { id: 'r2', bookId: 'b', status: 'WAITING', copyId: null, holdUntil: null, createdAt: at(2) },
      ],
      [{ id: 'c1', bookId: 'b', status: 'AVAILABLE' }],
    );
    await settleHolds(db as never, 'b', '2026-11-05');
    expect(db.reservations[0]).toMatchObject({ status: 'EXPIRED', copyId: null });
    expect(db.reservations[1]).toMatchObject({ status: 'READY', copyId: 'c1' });
  });
});
