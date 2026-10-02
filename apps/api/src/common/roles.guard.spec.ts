import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import type { AuthUser } from './auth-user.js';
import { RolesGuard } from './roles.guard.js';

function contextFor(user: AuthUser | undefined): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

const teacher: AuthUser = {
  sub: 'u1',
  schoolId: 's1',
  name: 'Ayesha',
  roles: [{ role: Role.TEACHER, campusId: 'c1' }],
};

describe('RolesGuard', () => {
  it('allows routes with no role requirement', () => {
    const reflector = { getAllAndOverride: () => undefined } as unknown as Reflector;
    expect(new RolesGuard(reflector).canActivate(contextFor(teacher))).toBe(true);
  });

  it('allows a user holding one of the required roles', () => {
    const reflector = {
      getAllAndOverride: () => [Role.ADMIN, Role.TEACHER],
    } as unknown as Reflector;
    expect(new RolesGuard(reflector).canActivate(contextFor(teacher))).toBe(true);
  });

  it('rejects a user without a required role', () => {
    const reflector = {
      getAllAndOverride: () => [Role.OWNER],
    } as unknown as Reflector;
    expect(() => new RolesGuard(reflector).canActivate(contextFor(teacher))).toThrow(
      ForbiddenException,
    );
  });
});
