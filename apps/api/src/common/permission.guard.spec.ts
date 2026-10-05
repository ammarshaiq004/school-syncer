import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import type { AuthUser } from './auth-user.js';
import { IS_PLATFORM, IS_PUBLIC, PERMISSION, type PermissionRequirement } from './decorators.js';
import { deniedMessage, PermissionGuard, requiredLevel } from './permission.guard.js';
import type { PermissionService } from './permission.service.js';
import { effectivePermissions, type PermissionOverrides } from './permissions.js';

function contextFor(user: AuthUser | undefined, method = 'GET'): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user, method }) }),
  } as unknown as ExecutionContext;
}

function reflectorWith(meta: Record<string, unknown>): Reflector {
  return { getAllAndOverride: (key: string) => meta[key] } as unknown as Reflector;
}

function serviceWith(overrides: PermissionOverrides = {}): PermissionService {
  return {
    levelFor: async (user: AuthUser, module: keyof ReturnType<typeof effectivePermissions>) =>
      effectivePermissions(user.roles, overrides)[module],
  } as unknown as PermissionService;
}

const accountant: AuthUser = {
  sub: 'u1',
  schoolId: 's1',
  name: 'Bilal',
  roles: [{ role: Role.ACCOUNTANT, campusId: null }],
};
const fees = (level?: PermissionRequirement['level']) => ({ [PERMISSION]: { module: 'fees', level } });

describe('requiredLevel', () => {
  it('needs view for reads and manage for writes unless a level is given', () => {
    expect(requiredLevel({ module: 'fees' }, 'GET')).toBe('view');
    expect(requiredLevel({ module: 'fees' }, 'head')).toBe('view');
    expect(requiredLevel({ module: 'fees' }, 'POST')).toBe('manage');
    expect(requiredLevel({ module: 'fees' }, 'DELETE')).toBe('manage');
    expect(requiredLevel({ module: 'fees', level: 'manage' }, 'GET')).toBe('manage');
    expect(requiredLevel({ module: 'fees', level: 'view' }, 'POST')).toBe('view');
  });
});

describe('deniedMessage', () => {
  it('names the module', () => {
    expect(deniedMessage('fees', 'none')).toBe('Your role does not have access to Fees');
    expect(deniedMessage('fees', 'view')).toBe('Your role can view Fees but cannot change it');
  });
});

describe('PermissionGuard', () => {
  it('lets through routes without @Permission, public and platform routes', async () => {
    await expect(new PermissionGuard(reflectorWith({}), serviceWith()).canActivate(contextFor(accountant))).resolves.toBe(true);
    await expect(
      new PermissionGuard(reflectorWith({ ...fees(), [IS_PUBLIC]: true }), serviceWith()).canActivate(contextFor(undefined, 'POST')),
    ).resolves.toBe(true);
    await expect(
      new PermissionGuard(reflectorWith({ ...fees(), [IS_PLATFORM]: true }), serviceWith()).canActivate(contextFor(undefined, 'POST')),
    ).resolves.toBe(true);
  });

  it('uses the default matrix', async () => {
    const guard = new PermissionGuard(reflectorWith(fees()), serviceWith());
    await expect(guard.canActivate(contextFor(accountant, 'POST'))).resolves.toBe(true);
    const audit = new PermissionGuard(reflectorWith({ [PERMISSION]: { module: 'audit' } }), serviceWith());
    await expect(audit.canActivate(contextFor(accountant))).rejects.toThrow('Your role does not have access to Audit log');
  });

  it('applies school edits: view-only refuses writes but allows reads', async () => {
    const service = serviceWith({ builtin: { ACCOUNTANT: { fees: 'view' } } });
    const guard = new PermissionGuard(reflectorWith(fees()), service);
    await expect(guard.canActivate(contextFor(accountant, 'GET'))).resolves.toBe(true);
    await expect(guard.canActivate(contextFor(accountant, 'POST'))).rejects.toThrow(ForbiddenException);
  });

  it('applies a custom role grant', async () => {
    const service = serviceWith({ custom: { cr1: { baseRole: Role.ACCOUNTANT, permissions: { fees: 'none' } } } });
    const user = { ...accountant, roles: [{ role: Role.ACCOUNTANT, campusId: null, customRoleId: 'cr1' }] };
    const guard = new PermissionGuard(reflectorWith(fees('view')), service);
    await expect(guard.canActivate(contextFor(user))).rejects.toThrow('Your role does not have access to Fees');
  });

  it('refuses a request without a school user', async () => {
    const guard = new PermissionGuard(reflectorWith(fees()), serviceWith());
    await expect(guard.canActivate(contextFor(undefined))).rejects.toThrow(ForbiddenException);
  });
});
