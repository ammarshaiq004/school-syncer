// Kept in step with apps/api/src/app-version/version.ts: the API decides who
// is refused (426), the app decides what to show. Plain TypeScript with no
// imports so `node --test` can run version.test.mjs against it.

/** Store versions: one to three whole numbers ("2", "2.1", "2.1.3"). */
const VERSION = /^\d{1,6}(\.\d{1,6}){0,2}$/;

export function parseVersion(value: unknown): [number, number, number] | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!VERSION.test(v)) return null;
  const [major = 0, minor = 0, patch = 0] = v.split('.').map(Number);
  return [major, minor, patch];
}

/** Negative when a is older than b; null when either is not a version. */
export function compareVersions(a: string, b: string): number | null {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] - y[i];
  }
  return 0;
}

export type UpdateStatus = 'required' | 'available' | 'current';

/** Below the minimum: must update. Below the latest: may update. Unreadable: current (fail open). */
export function updateStatus(version: string, policy: { minVersion: string; latestVersion: string }): UpdateStatus {
  if ((compareVersions(version, policy.minVersion) ?? 0) < 0) return 'required';
  if ((compareVersions(version, policy.latestVersion) ?? 0) < 0) return 'available';
  return 'current';
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The "Update available" banner shows at most once a day: not again within 24 h of the last time. */
export function bannerDue(lastShownAt: string | null, now: number): boolean {
  if (!lastShownAt) return true;
  const last = Number(lastShownAt);
  if (!Number.isFinite(last)) return true;
  return now - last >= DAY_MS || now < last;
}
