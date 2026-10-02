/**
 * Normalises a Pakistani mobile number to international format without "+",
 * e.g. "0300-1234567" -> "923001234567". Other numbers are returned digits-only.
 */
export function toInternational(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0092')) return digits.slice(2);
  if (digits.startsWith('92')) return digits;
  if (digits.startsWith('03') && digits.length === 11) return `92${digits.slice(1)}`;
  if (digits.startsWith('3') && digits.length === 10) return `92${digits}`;
  return digits;
}
