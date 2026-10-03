import { randomInt } from 'node:crypto';
import { CertificateType } from '@prisma/client';

export const SERIAL_PREFIX: Record<CertificateType, string> = {
  LEAVING: 'SLC',
  CHARACTER: 'CC',
  ENROLMENT: 'EC',
};

/** The next serial for a type and year, after the highest already issued: "SLC-2026-0008". */
export function nextSerial(
  type: CertificateType,
  year: number,
  existing: string[],
): string {
  const prefix = `${SERIAL_PREFIX[type]}-${year}-`;
  const highest = existing
    .filter((s) => s.startsWith(prefix))
    .reduce((max, s) => Math.max(max, Number(s.slice(prefix.length)) || 0), 0);
  return `${prefix}${String(highest + 1).padStart(4, '0')}`;
}

// No 0/O, 1/I/L: the code is read off paper and typed in.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** A code printed on the certificate that anyone can check online. */
export function verifyCode(length = 10): string {
  return Array.from(
    { length },
    () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
  ).join('');
}

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety',
];
const ORDINAL_ONES = [
  '',
  'First',
  'Second',
  'Third',
  'Fourth',
  'Fifth',
  'Sixth',
  'Seventh',
  'Eighth',
  'Ninth',
  'Tenth',
  'Eleventh',
  'Twelfth',
  'Thirteenth',
  'Fourteenth',
  'Fifteenth',
  'Sixteenth',
  'Seventeenth',
  'Eighteenth',
  'Nineteenth',
];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** 0–99 in words. */
function underHundred(n: number): string {
  if (n < 20) return ONES[n];
  return [TENS[Math.floor(n / 10)], ONES[n % 10]].filter(Boolean).join('-');
}

function ordinalDay(n: number): string {
  if (n < 20) return ORDINAL_ONES[n];
  if (n % 10 === 0) return `${TENS[n / 10].slice(0, -1)}ieth`;
  return `${TENS[Math.floor(n / 10)]}-${ORDINAL_ONES[n % 10]}`;
}

function yearInWords(year: number): string {
  const thousands = Math.floor(year / 1000);
  const hundreds = Math.floor((year % 1000) / 100);
  const rest = year % 100;
  if (thousands === 0 || (thousands === 1 && hundreds > 0)) {
    // 1998: Nineteen Ninety-Eight
    const head = underHundred(Math.floor(year / 100));
    return rest ? `${head} ${underHundred(rest)}` : `${head} Hundred`;
  }
  const parts = [`${ONES[thousands]} Thousand`];
  if (hundreds) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest) parts.push(`and ${underHundred(rest)}`);
  return parts.join(' ');
}

/**
 * A YYYY-MM-DD date in words, as leaving certificates print the date of
 * birth: "Fifteenth March, Two Thousand and Fourteen".
 */
export function dateInWords(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${ordinalDay(d)} ${MONTHS[m - 1]}, ${yearInWords(y)}`;
}
