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

/**
 * The digits to look for when searching stored phone numbers, ignoring the
 * prefix: "0300-1234567", "+92 300 1234567" and "03001234567" all give
 * "3001234567". Null when the text holds too few digits to be a phone search.
 */
export function phoneSearchDigits(text: string): string | null {
  if (/[a-z@]/i.test(text)) return null;
  const digits = text.replace(/\D/g, '').replace(/^(0092|92|0)/, '');
  return digits.length >= 5 ? digits : null;
}

/** A phone number for server logs: country code and the last two digits only, "92300*****67". */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return '*'.repeat(digits.length);
  return `${digits.slice(0, 5)}${'*'.repeat(digits.length - 7)}${digits.slice(-2)}`;
}

/** Masks every phone-like run of digits (7 or more) in free text, e.g. a provider's error. */
export function maskPhonesIn(text: string): string {
  return text.replace(/\+?\d[\d -]{5,}\d/g, (m) => maskPhone(m));
}
