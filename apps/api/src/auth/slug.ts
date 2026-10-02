/** Turns a school name into a URL-safe slug, e.g. "Beaconhouse Lahore" -> "beaconhouse-lahore". */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
