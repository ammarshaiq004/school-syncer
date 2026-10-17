import pkg from "../../package.json";

/** The web app's version, sent with problem reports. NEXT_PUBLIC_APP_VERSION (a release tag or commit) wins when set at build time. */
export const APP_VERSION: string = process.env.NEXT_PUBLIC_APP_VERSION || pkg.version;

/** Store versions: one to three whole numbers ("2", "2.1", "2.1.3"), as the API accepts them. */
const VERSION = /^\d{1,6}(\.\d{1,6}){0,2}$/;

export const isVersion = (v: string) => VERSION.test(v.trim());

/** Negative when a is older than b; null when either is not a version. */
export function compareVersions(a: string, b: string): number | null {
  if (!isVersion(a) || !isVersion(b)) return null;
  const x = a.trim().split(".").map(Number);
  const y = b.trim().split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** True when saving would refuse builds that work today. */
export const raisesMinimum = (current: string, next: string) => (compareVersions(next, current) ?? 0) > 0;
