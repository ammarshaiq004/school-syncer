import { randomInt } from 'node:crypto';

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function code(length: number) {
  return Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
}

/** Voucher number printed on the fee slip, e.g. "202610-K7Q2MX". */
export const voucherNo = (period: string) => `${period.replace('-', '')}-${code(6)}`;

/** Receipt number for a payment, e.g. "R-9F3KX2QA". */
export const receiptNo = () => `R-${code(8)}`;
