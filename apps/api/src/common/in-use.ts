import { ConflictException } from '@nestjs/common';

/**
 * Setup records (classes, sections, subjects, years, fee heads) are deleted
 * only while nothing uses them, so a slip never wipes out attendance, marks
 * or fee history through a cascade. `uses` counts what still refers to the
 * record, keyed by a singular noun ("section", "fee amount").
 *
 * Returns the message for a refused delete, or null when it is safe.
 */
export function inUseMessage(what: string, uses: Record<string, number>): string | null {
  const parts = Object.entries(uses)
    .filter(([, n]) => n > 0)
    .map(([noun, n]) => `${n} ${n === 1 ? noun : plural(noun)}`);
  if (!parts.length) return null;
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `${what} is in use (${list}), so it can't be deleted. Remove or move those first, or rename it instead.`;
}

/** Throws 409 with inUseMessage when anything still uses the record. */
export function assertUnused(what: string, uses: Record<string, number>) {
  const message = inUseMessage(what, uses);
  if (message) throw new ConflictException(message);
}

function plural(noun: string) {
  if (noun.endsWith('quiz')) return `${noun}zes`;
  if (/(s|x|z|ch|sh)$/.test(noun)) return `${noun}es`;
  if (noun.endsWith('y') && !/[aeiou]y$/.test(noun)) return `${noun.slice(0, -1)}ies`;
  return `${noun}s`;
}
