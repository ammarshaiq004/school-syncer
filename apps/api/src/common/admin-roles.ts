import { ForbiddenException } from '@nestjs/common';
import { Role, type Prisma } from '@prisma/client';
import type { AuthUser } from './auth-user.js';

/** Roles allowed to change school setup (campuses, classes, users). */
export const SETUP_ROLES: Role[] = [Role.OWNER, Role.PRINCIPAL, Role.ADMIN];

/** Everyone who works at the school, as opposed to parents and students. */
export const STAFF_ROLES: Role[] = [
  Role.OWNER,
  Role.PRINCIPAL,
  Role.ADMIN,
  Role.ACCOUNTANT,
  Role.TEACHER,
  Role.CLASS_TEACHER,
  Role.STAFF,
];

export const FEE_ROLES: Role[] = [
  Role.OWNER,
  Role.PRINCIPAL,
  Role.ADMIN,
  Role.ACCOUNTANT,
];

export const ATTENDANCE_ROLES: Role[] = [
  ...SETUP_ROLES,
  Role.TEACHER,
  Role.CLASS_TEACHER,
];

export function hasAnyRole(user: AuthUser, roles: Role[]): boolean {
  return user.roles.some((grant) => roles.includes(grant.role));
}

/**
 * Campuses where the user holds one of `roles`: null means at least one of
 * those grants is school-wide, an empty list means they hold none of them.
 * Only the named roles count, so a teacher grant on another campus (or a
 * school-wide staff grant) never widens what an admin grant reaches.
 */
export function campusScopeFor(user: AuthUser, roles: Role[]): string[] | null {
  const grants = user.roles.filter((g) => roles.includes(g.role));
  if (grants.some((g) => g.campusId === null)) return null;
  return [...new Set(grants.map((g) => g.campusId as string))];
}

/**
 * Campuses a staff user may see: null means every campus (a school-wide
 * staff role), otherwise the campuses named on their role grants.
 */
export function campusScope(user: AuthUser): string[] | null {
  return campusScopeFor(user, STAFF_ROLES);
}

/**
 * Campuses a user may administer, from their setup-role grants alone: null
 * means the whole school, [] means they are not an administrator anywhere.
 */
export function adminScope(user: AuthUser): string[] | null {
  return campusScopeFor(user, SETUP_ROLES);
}

/**
 * Refuses a user whose `roles` grants are all campus-limited: for actions that
 * change or reveal the whole school at once (the role matrix, payroll runs,
 * merchant accounts). Admin roles by default.
 */
export function assertSchoolWide(user: AuthUser, message: string, roles: Role[] = SETUP_ROLES) {
  if (campusScopeFor(user, roles)) throw new ForbiddenException(message);
}

/** True when `campusId` is inside `scope` (null scope = every campus). */
export const inScope = (scope: string[] | null, campusId: string | null): boolean =>
  scope === null || (campusId !== null && scope.includes(campusId));

/** True when the user may administer `campusId` (a setup-role grant there or school-wide). */
export const administers = (user: AuthUser, campusId: string): boolean => inScope(adminScope(user), campusId);

/**
 * Sections a user works with: every section on the campuses they administer,
 * plus those they are class teacher of or teach a subject in. Empty (no
 * narrowing) for a school-wide administrator.
 */
export function workingSections(user: AuthUser): Prisma.SectionWhereInput {
  const admin = adminScope(user);
  if (admin === null) return {};
  return {
    OR: [
      ...(admin.length ? [{ class: { campusId: { in: admin } } }] : []),
      { classTeacherId: user.sub },
      { subjects: { some: { teacherId: user.sub } } },
    ],
  };
}
