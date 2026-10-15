/**
 * Removes personal data and secrets from anything that leaves the server for
 * an error tracker or an alert: passwords, tokens, keys, CNICs, phone numbers
 * and payment secrets. Keys that name a secret lose their value whatever it
 * is; other strings keep their text with CNICs, phones, tokens and card-like
 * numbers masked. Used on Sentry events, which may hold request bodies,
 * headers, URLs and error messages.
 */

export const REDACTED = '[redacted]';

/** Keys whose values are always dropped (matched without case, -, _ or spaces). */
const SECRET_KEY =
  /pass(word|wd|code)?$|^pwd$|secret|token|authorization|cookie|apikey|accesskey|privatekey|signature|^sig$|salt|hashkey|^otp$|^pin$|^code$|resetcode|cnic|bform|nationalid|phone|mobile|whatsapp|msisdn|^to$|cardnumber|^pan$|^cvv|iban|accountnum|dsn/;

const normaliseKey = (key: string) => key.toLowerCase().replace(/[-_\s]/g, '');

export const isSecretKey = (key: string) => SECRET_KEY.test(normaliseKey(key));

/** Patterns masked inside free text, most specific first. */
const TEXT_PATTERNS: [RegExp, string][] = [
  // JWTs (three base64url parts, the first starting with {")
  [/eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, '[jwt]'],
  // Bearer/Basic credentials in a header copied into a message
  [/\b(Bearer|Basic)\s+[\w.~+/=-]{8,}/gi, '$1 [redacted]'],
  // Secrets in URLs or key=value text (?token=..., password: ...)
  [/\b(pass(?:word)?|secret|token|api[_-]?key|access[_-]?key|sig|signature|code|otp|salt|hash[_-]?key)(["']?\s*[=:]\s*["']?)[^\s&"',;}]+/gi, '$1$2[redacted]'],
  // CNIC / B-Form: 12345-1234567-1 or 13 digits
  [/\b\d{5}-\d{7}-\d\b/g, '[cnic]'],
  // Card-like runs of 13 to 19 digits, possibly grouped by spaces or dashes
  [/\b(?:\d[ -]?){12,18}\d\b/g, '[number]'],
  // Pakistani mobiles: +92 300 1234567, 0300-1234567, 92 3001234567
  [/(?:\+?\b92|\b0)[ -]?3\d{2}[ -]?\d{7}\b/g, '[phone]'],
  // Other international numbers written with a + (+44 20 7946 0958)
  [/\+\d[\d ()-]{7,}\d\b/g, '[phone]'],
  // Bare runs of 10 to 12 digits (923001234567)
  [/\b\d{10,12}\b/g, '[phone]'],
  // Email addresses
  [/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '[email]'],
];

/** Masks CNICs, phones, emails, tokens and inline secrets in a piece of text. */
export function scrubText(text: string): string {
  let out = text;
  for (const [pattern, replacement] of TEXT_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

/**
 * A copy of `value` with secret keys redacted and every string scrubbed.
 * Depth-limited, so a cyclic or huge object cannot hang the reporter.
 */
export function scrub<T>(value: T, depth = 0): T {
  if (typeof value === 'string') return scrubText(value) as T;
  if (value === null || typeof value !== 'object') return value;
  if (depth > 8) return '[truncated]' as T;
  if (Array.isArray(value)) return value.slice(0, 100).map((v) => scrub(v, depth + 1)) as T;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSecretKey(key) && v !== null && v !== undefined && v !== '' ? REDACTED : scrub(v, depth + 1);
  }
  return out as T;
}
