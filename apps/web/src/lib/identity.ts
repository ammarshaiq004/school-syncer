/**
 * The API stores CNICs and B-Forms as 13 digits and mobiles as 03XXXXXXXXX
 * (apps/api/src/common/identity.ts); these format them for people.
 */

/** 3520212345671 -> 35202-1234567-1; anything else as stored. */
export function formatCnic(value: string | null | undefined): string {
  if (!value) return "";
  return /^\d{13}$/.test(value) ? `${value.slice(0, 5)}-${value.slice(5, 12)}-${value.slice(12)}` : value;
}

/** 03001234567 -> 0300 1234567; anything else as stored. */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return "";
  return /^03\d{9}$/.test(value) ? `${value.slice(0, 4)} ${value.slice(4)}` : value;
}

/** For wa.me links: 03001234567 -> 923001234567. */
export const whatsAppNumber = (phone: string) => phone.replace(/\D/g, "").replace(/^0/, "92");

/** A check the API wants confirmed before saving a student or guardian (409 NEEDS_CONFIRMATION). */
export type SaveWarning =
  | { kind: "guardian_name"; phone: string; givenName: string; existingName: string; children: string[]; message: string }
  | { kind: "duplicate"; studentId: string; name: string; admissionNo: string; message: string };

/** The warnings from a NEEDS_CONFIRMATION answer, or null for any other error. */
export function saveWarnings(e: unknown): SaveWarning[] | null {
  // Duck-typed (an ApiError from lib/api) so this file runs under node --test.
  const err = e as { status?: number; data?: { code?: string; warnings?: SaveWarning[] } | null } | null;
  if (!err || err.status !== 409) return null;
  const data = err.data;
  return data?.code === "NEEDS_CONFIRMATION" && Array.isArray(data.warnings) ? data.warnings : null;
}
