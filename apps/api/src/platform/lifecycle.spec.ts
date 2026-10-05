import { PlatformRole, SubscriptionStatus as S } from '@prisma/client';
import { lifecycleTarget, staffChangeError } from './lifecycle.js';
import { temporaryPassword } from './temp-password.js';

describe('lifecycleTarget', () => {
  it('suspends a working school', () => {
    expect(lifecycleTarget('suspend', S.ACTIVE)).toEqual({ status: S.SUSPENDED });
    expect(lifecycleTarget('suspend', S.TRIAL)).toEqual({ status: S.SUSPENDED });
    expect(lifecycleTarget('suspend', S.SUSPENDED)).toHaveProperty('error');
    expect(lifecycleTarget('suspend', S.CANCELLED)).toHaveProperty('error');
  });
  it('reactivates only suspended or closed schools', () => {
    expect(lifecycleTarget('reactivate', S.SUSPENDED)).toEqual({ status: S.ACTIVE });
    expect(lifecycleTarget('reactivate', S.CANCELLED)).toEqual({ status: S.ACTIVE });
    expect(lifecycleTarget('reactivate', S.ACTIVE)).toHaveProperty('error');
  });
  it('closes a school once', () => {
    expect(lifecycleTarget('cancel', S.PAST_DUE)).toEqual({ status: S.CANCELLED });
    expect(lifecycleTarget('cancel', S.CANCELLED)).toHaveProperty('error');
  });
});

describe('staffChangeError', () => {
  const owner = { id: 'a', role: PlatformRole.OWNER, isActive: true };
  const support = { id: 'b', role: PlatformRole.SUPPORT, isActive: true };
  it('stops people locking themselves out', () => {
    expect(staffChangeError('a', owner, { isActive: false }, 3)).toMatch(/deactivate your own/);
    expect(staffChangeError('a', owner, { role: PlatformRole.SUPPORT }, 3)).toMatch(/own role/);
    expect(staffChangeError('a', owner, { role: PlatformRole.OWNER }, 1)).toBeNull();
  });
  it('keeps one active owner', () => {
    expect(staffChangeError('x', owner, { isActive: false }, 1)).toMatch(/at least one/);
    expect(staffChangeError('x', owner, { role: PlatformRole.SUPPORT }, 1)).toMatch(/at least one/);
    expect(staffChangeError('x', owner, { isActive: false }, 2)).toBeNull();
  });
  it('lets an owner change support staff', () => {
    expect(staffChangeError('a', support, { isActive: false }, 1)).toBeNull();
    expect(staffChangeError('a', support, { role: PlatformRole.OWNER }, 1)).toBeNull();
  });
});

describe('temporaryPassword', () => {
  it('is long enough, readable and contains a digit', () => {
    for (let i = 0; i < 50; i++) {
      const p = temporaryPassword();
      expect(p).toHaveLength(12);
      expect(p).toMatch(/\d/);
      expect(p).not.toMatch(/[0O1lI]/);
    }
    expect(temporaryPassword()).not.toBe(temporaryPassword());
  });
});
