import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannerDue, compareVersions, parseVersion, updateStatus } from './version.ts';

test('reads store versions only', () => {
  assert.deepEqual(parseVersion('2.1'), [2, 1, 0]);
  assert.deepEqual(parseVersion(' 1.0.12 '), [1, 0, 12]);
  for (const v of ['', 'v1', '1.2.3.4', '1.2-beta', null]) assert.equal(parseVersion(v), null);
});

test('compares numerically, not as text', () => {
  assert.ok(compareVersions('1.10.0', '1.9.0') > 0);
  assert.ok(compareVersions('1.2.3', '1.2.10') < 0);
  assert.equal(compareVersions('1.2', '1.2.0'), 0);
  assert.equal(compareVersions('dev', '1.0.0'), null);
});

test('decides between the update screen, the banner and nothing', () => {
  const policy = { minVersion: '1.2.0', latestVersion: '1.4.0' };
  assert.equal(updateStatus('1.1.9', policy), 'required');
  assert.equal(updateStatus('1.2.0', policy), 'available');
  assert.equal(updateStatus('1.4.0', policy), 'current');
  assert.equal(updateStatus('2.0.0', policy), 'current');
  // A version it cannot read never locks the app.
  assert.equal(updateStatus('dev', policy), 'current');
  assert.equal(updateStatus('1.0.0', { minVersion: '', latestVersion: '' }), 'current');
});

test('shows the banner at most once a day', () => {
  const now = Date.UTC(2026, 9, 15, 12);
  const hour = 60 * 60 * 1000;
  assert.equal(bannerDue(null, now), true);
  assert.equal(bannerDue(String(now - 3 * hour), now), false);
  assert.equal(bannerDue(String(now - 24 * hour), now), true);
  assert.equal(bannerDue('garbage', now), true);
  // A clock moved backwards does not hide it for good.
  assert.equal(bannerDue(String(now + 48 * hour), now), true);
});
