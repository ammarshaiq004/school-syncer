import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * This build's version as the store knows it (CFBundleShortVersionString /
 * versionName), falling back to app.json's "version" in Expo Go and the web
 * preview.
 */
export const APP_VERSION = Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '0.0.0';

/** iOS buildNumber / Android versionCode; empty in Expo Go and on the web. */
export const APP_BUILD = Application.nativeBuildVersion ?? '';

/** ios, android or web. The API only gates ios and android. */
export const APP_PLATFORM = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web';

/** Sent on every API request (see docs/api-compatibility.md). */
export const APP_HEADERS: Record<string, string> = {
  'X-App-Version': APP_VERSION,
  'X-App-Build': APP_BUILD,
  'X-App-Platform': APP_PLATFORM,
};

/** The web portal, inlined at build time like EXPO_PUBLIC_API_URL; the app links to its privacy policy. */
const WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL ?? (__DEV__ ? 'http://localhost:3000' : '')).replace(/\/$/, '');
if (!WEB_URL) {
  console.error('EXPO_PUBLIC_WEB_URL was not set when this app was built; the privacy policy link will not open.');
}

export const PRIVACY_URL = WEB_URL ? `${WEB_URL}/privacy` : '';
