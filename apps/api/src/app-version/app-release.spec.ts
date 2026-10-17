import { defaultReleases, mergeRelease, platformFromHeader } from './app-release.js';

describe('defaultReleases', () => {
  it('asks nothing of any build when no env is set', () => {
    const releases = defaultReleases({});
    expect(releases.IOS).toEqual({ minVersion: '0.0.0', latestVersion: '0.0.0', storeUrl: '', message: '' });
    expect(releases.ANDROID.storeUrl).toBe('https://play.google.com/store/apps/details?id=pk.schoolsyncer.app');
  });

  it('reads each platform from its own env names', () => {
    const releases = defaultReleases({
      APP_MIN_VERSION_IOS: '1.1.0',
      APP_LATEST_VERSION_IOS: '1.3.0',
      APP_STORE_URL_IOS: 'https://apps.apple.com/app/id123',
      APP_MIN_VERSION_ANDROID: '1.2.0',
      APP_UPDATE_MESSAGE: 'New fee screen',
    });
    expect(releases.IOS).toEqual({
      minVersion: '1.1.0',
      latestVersion: '1.3.0',
      storeUrl: 'https://apps.apple.com/app/id123',
      message: 'New fee screen',
    });
    // No latest set: the latest is the minimum.
    expect(releases.ANDROID).toMatchObject({ minVersion: '1.2.0', latestVersion: '1.2.0', message: 'New fee screen' });
  });

  it('ignores versions it cannot read', () => {
    expect(defaultReleases({ APP_MIN_VERSION_IOS: 'soon' }).IOS.minVersion).toBe('0.0.0');
  });
});

describe('mergeRelease', () => {
  const fallback = { minVersion: '1.0.0', latestVersion: '1.0.0', storeUrl: 'https://store/app', message: 'env' };

  it('uses the default without a console row', () => {
    expect(mergeRelease(fallback, null)).toEqual(fallback);
  });

  it('lets the console set versions and fall back for an empty link or message', () => {
    expect(mergeRelease(fallback, { minVersion: '1.2.0', latestVersion: '1.5.0', storeUrl: '', message: '' })).toEqual({
      minVersion: '1.2.0',
      latestVersion: '1.5.0',
      storeUrl: 'https://store/app',
      message: 'env',
    });
    expect(mergeRelease(fallback, { minVersion: '1.2.0', latestVersion: '1.5.0', storeUrl: 'https://x', message: 'Hi' })).toMatchObject({
      storeUrl: 'https://x',
      message: 'Hi',
    });
  });
});

describe('platformFromHeader', () => {
  it('knows the two stores, in any case', () => {
    expect(platformFromHeader('ios')).toBe('IOS');
    expect(platformFromHeader(' Android ')).toBe('ANDROID');
  });

  it('treats web and anything else as not the app', () => {
    expect(platformFromHeader('web')).toBeNull();
    expect(platformFromHeader(undefined)).toBeNull();
    expect(platformFromHeader(['ios'])).toBeNull();
  });
});
