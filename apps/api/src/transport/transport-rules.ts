/** A rider's monthly transport fee: their stop's own fee, else the route's. */
export function riderFee(
  route: { monthlyFee: number },
  stop: { monthlyFee: number | null } | null,
): number {
  return stop?.monthlyFee ?? route.monthlyFee;
}

/** The first and last day (YYYY-MM-DD) of a YYYY-MM month. */
export function monthBounds(period: string): { first: string; last: string } {
  const [y, m] = period.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    first: `${period}-01`,
    last: `${period}-${String(last).padStart(2, '0')}`,
  };
}

/**
 * Whether a student rode during any part of a month, so that month's fee
 * voucher should charge for transport. A student who starts on the 20th or
 * stops on the 5th still pays for that month, as schools usually charge.
 */
export function ridesDuring(
  a: { startsOn: Date; endsOn: Date | null },
  period: string,
): boolean {
  const { first, last } = monthBounds(period);
  const start = a.startsOn.toISOString().slice(0, 10);
  const end = a.endsOn?.toISOString().slice(0, 10) ?? null;
  return start <= last && (end === null || end >= first);
}

/** "07:05" style times, or empty. */
export const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
