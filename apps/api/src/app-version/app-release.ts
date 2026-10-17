import { AppPlatform } from '@prisma/client';
import { isVersion } from './version.js';

/** One store's version policy as the app and the console see it. */
export interface AppRelease {
  minVersion: string;
  latestVersion: string;
  storeUrl: string;
  message: string;
}

export type AppReleases = Record<AppPlatform, AppRelease>;

export const APP_PLATFORMS = [AppPlatform.IOS, AppPlatform.ANDROID] as const;

/** The app's identifier on Google Play (apps/mobile/app.json android.package). */
const ANDROID_PACKAGE = 'pk.schoolsyncer.app';

type Env = Record<string, string | undefined>;

const envText = (env: Env, key: string) => env[key]?.trim() ?? '';

/** Env names per platform, e.g. APP_MIN_VERSION_IOS. */
export const appEnvKeys = (platform: AppPlatform) => ({
  minVersion: `APP_MIN_VERSION_${platform}`,
  latestVersion: `APP_LATEST_VERSION_${platform}`,
  storeUrl: `APP_STORE_URL_${platform}`,
});

/**
 * The policy before anyone has used the console: APP_MIN_VERSION_*,
 * APP_LATEST_VERSION_* and APP_STORE_URL_* per platform, APP_UPDATE_MESSAGE
 * for both. Unset versions are 0.0.0 (nothing is refused or nagged); the
 * latest is never below the minimum.
 */
export function defaultReleases(env: Env): AppReleases {
  const message = envText(env, 'APP_UPDATE_MESSAGE');
  const release = (platform: AppPlatform): AppRelease => {
    const keys = appEnvKeys(platform);
    const min = envText(env, keys.minVersion);
    const latest = envText(env, keys.latestVersion);
    const minVersion = isVersion(min) ? min : '0.0.0';
    return {
      minVersion,
      latestVersion: isVersion(latest) ? latest : minVersion,
      storeUrl:
        envText(env, keys.storeUrl) ||
        (platform === AppPlatform.ANDROID
          ? `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`
          : ''),
      message,
    };
  };
  return { IOS: release(AppPlatform.IOS), ANDROID: release(AppPlatform.ANDROID) };
}

/** A console row over the env default: empty store link and message fall back to the default. */
export function mergeRelease(
  fallback: AppRelease,
  row: Partial<AppRelease> | null | undefined,
): AppRelease {
  if (!row) return fallback;
  return {
    minVersion: row.minVersion ?? fallback.minVersion,
    latestVersion: row.latestVersion ?? fallback.latestVersion,
    storeUrl: row.storeUrl || fallback.storeUrl,
    message: row.message || fallback.message,
  };
}

/** The X-App-Platform header as a store, or null for web and unknown clients. */
export function platformFromHeader(value: unknown): AppPlatform | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (v === 'ios') return AppPlatform.IOS;
  if (v === 'android') return AppPlatform.ANDROID;
  return null;
}
