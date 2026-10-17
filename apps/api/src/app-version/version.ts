/**
 * App version numbers as the stores use them: up to three dot-separated
 * whole numbers ("2", "2.1", "2.1.3"). Anything else (pre-release tags,
 * letters, empty) is not a version we gate on.
 */
const VERSION = /^\d{1,6}(\.\d{1,6}){0,2}$/;

/** [major, minor, patch], missing parts as 0; null when not a version. */
export function parseVersion(value: unknown): [number, number, number] | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!VERSION.test(v)) return null;
  const [major = 0, minor = 0, patch = 0] = v.split('.').map(Number);
  return [major, minor, patch];
}

export const isVersion = (value: unknown) => parseVersion(value) !== null;

/** Negative when a is older than b, 0 when equal, positive when newer. Both must be versions. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) throw new Error(`Not a version: ${x ? b : a}`);
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] - y[i];
  }
  return 0;
}

export type UpdateStatus = 'required' | 'available' | 'current';

/**
 * What a build should do: update before carrying on (below the minimum),
 * offer an update (below the latest), or nothing. An unreadable version
 * counts as current, so a bad header never locks anyone out.
 */
export function updateStatus(
  version: unknown,
  policy: { minVersion: string; latestVersion: string },
): UpdateStatus {
  if (!isVersion(version)) return 'current';
  const v = version as string;
  if (isVersion(policy.minVersion) && compareVersions(v, policy.minVersion) < 0) return 'required';
  if (isVersion(policy.latestVersion) && compareVersions(v, policy.latestVersion) < 0) return 'available';
  return 'current';
}
