import { randomInt } from 'node:crypto';

// No 0/O, 1/l/I: easy to read out over the phone.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/**
 * A one-time password shown once to whoever creates or resets an account.
 * Always contains a digit so it passes "letters and numbers" style rules.
 */
export function temporaryPassword(length = 12): string {
  const chars = Array.from(
    { length },
    () => ALPHABET[randomInt(ALPHABET.length)],
  );
  chars[randomInt(length)] = String(2 + randomInt(8));
  return chars.join('');
}
