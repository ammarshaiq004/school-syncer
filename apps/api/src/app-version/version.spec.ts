import { compareVersions, isVersion, parseVersion, updateStatus } from './version.js';

describe('parseVersion', () => {
  it('reads one to three whole-number parts, padding with zeros', () => {
    expect(parseVersion('2')).toEqual([2, 0, 0]);
    expect(parseVersion('2.1')).toEqual([2, 1, 0]);
    expect(parseVersion(' 2.1.13 ')).toEqual([2, 1, 13]);
  });

  it('rejects anything the stores would not call a version', () => {
    for (const v of ['', 'v1.2', '1.2.3.4', '1..2', '1.2-beta', 'abc', '1.2.', '-1']) {
      expect(isVersion(v)).toBe(false);
    }
    expect(parseVersion(undefined)).toBeNull();
    expect(parseVersion(['1.0.0'])).toBeNull();
  });
});

describe('compareVersions', () => {
  it('compares numerically part by part, not as text', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.2.3', '1.2.10')).toBeLessThan(0);
    expect(compareVersions('2', '1.99.99')).toBeGreaterThan(0);
  });

  it('treats missing parts as zero', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1', '1.0.1')).toBeLessThan(0);
  });

  it('throws on something that is not a version', () => {
    expect(() => compareVersions('1.0', 'latest')).toThrow('Not a version: latest');
  });
});

describe('updateStatus', () => {
  const policy = { minVersion: '1.2.0', latestVersion: '1.4.0' };

  it('requires an update below the minimum', () => {
    expect(updateStatus('1.1.9', policy)).toBe('required');
  });

  it('offers an update from the minimum up to the latest', () => {
    expect(updateStatus('1.2.0', policy)).toBe('available');
    expect(updateStatus('1.3.5', policy)).toBe('available');
  });

  it('asks nothing of the latest or a newer build', () => {
    expect(updateStatus('1.4.0', policy)).toBe('current');
    expect(updateStatus('1.5.0', policy)).toBe('current');
  });

  it('never locks out a build whose version it cannot read', () => {
    expect(updateStatus('', policy)).toBe('current');
    expect(updateStatus(undefined, policy)).toBe('current');
    expect(updateStatus('dev', policy)).toBe('current');
  });

  it('ignores a policy version it cannot read', () => {
    expect(updateStatus('1.0.0', { minVersion: 'x', latestVersion: '1.4.0' })).toBe('available');
  });
});
