/** A settings list typed one per line: trimmed, blanks dropped, repeats (any case) kept once, sorted. */
export function cleanPickList(lines: string[]): string[] {
  const seen = new Map<string, string>();
  for (const line of lines) {
    const value = line.trim().replace(/\s+/g, ' ');
    if (value && !seen.has(value.toLowerCase())) seen.set(value.toLowerCase(), value);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
