import { z } from 'zod';

/**
 * Phone numbers, CNICs and B-Forms in one canonical form (SCHOOL-123), so
 * the same parent typed two ways is one guardian, logins match whatever the
 * parent types, and WhatsApp (notifications/phone.ts toInternational) gets a
 * number it understands.
 *
 * Phones: Pakistani mobiles as 03XXXXXXXXX (what logins and imports already
 * used). CNIC and B-Form: the 13 digits only; shown as 12345-1234567-1.
 */

/** Pakistani mobile numbers in any common spelling, as 03XXXXXXXXX. Undefined when it is not one. */
export function normalizePhone(value: string): string | undefined {
  const trimmed = value.trim();
  // Spaces, dashes, dots and brackets are formatting; a "+" only at the start.
  if (!/^\+?[\d\s\-().]+$/.test(trimmed)) return undefined;
  let digits = trimmed.replace(/\D/g, '');
  if (digits.startsWith('0092')) digits = digits.slice(4);
  else if (digits.startsWith('92') && digits.length >= 12) digits = digits.slice(2);
  // "0300…" and the common "+92 0300…" both carry a trunk 0.
  if (digits.startsWith('0')) digits = digits.slice(1);
  return /^3\d{9}$/.test(digits) ? `0${digits}` : undefined;
}

/** The 13 digits of a CNIC or B-Form typed with or without dashes or spaces. Undefined when it is not 13 digits. */
export function normalizeCnic(value: string): string | undefined {
  const trimmed = value.trim();
  if (!/^[\d\s-]+$/.test(trimmed)) return undefined;
  const digits = trimmed.replace(/\D/g, '');
  return /^\d{13}$/.test(digits) ? digits : undefined;
}

/** 3520212345671 -> 35202-1234567-1; anything else is returned as stored. */
export function formatCnic(value: string): string {
  return /^\d{13}$/.test(value) ? `${value.slice(0, 5)}-${value.slice(5, 12)}-${value.slice(12)}` : value;
}

export const PHONE_HINT = 'Use a mobile number like 0300 1234567';
export const CNIC_HINT = 'CNIC should be 13 digits like 35202-1234567-1';
export const BFORM_HINT = 'B-Form number should be 13 digits like 35202-1234567-1';

/** A field normalised with `fix`; `message` when it cannot be. */
const canonical = (fix: (v: string) => string | undefined, message: string) =>
  z
    .string()
    .trim()
    .max(40)
    .transform((value, ctx) => {
      const fixed = fix(value);
      if (fixed === undefined) {
        ctx.addIssue({ code: 'custom', message });
        return z.NEVER;
      }
      return fixed;
    });

/** A Pakistani mobile, stored as 03XXXXXXXXX. */
export const phoneField = canonical(normalizePhone, PHONE_HINT);
/** A CNIC, stored as 13 digits. */
export const cnicField = canonical(normalizeCnic, CNIC_HINT);
/** A B-Form number, stored as 13 digits. */
export const bFormField = canonical(normalizeCnic, BFORM_HINT);

/** Lower-cased with single spaces, for comparing names people typed. */
export const sameName = (a: string, b: string) => nameKey(a) === nameKey(b);
export const nameKey = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
