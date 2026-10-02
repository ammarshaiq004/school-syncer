import { Role } from '@prisma/client';
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
 * Campuses a staff user may see: null means every campus (a school-wide
 * staff role), otherwise the campuses named on their role grants.
 */
export function campusScope(user: AuthUser): string[] | null {
  const staffGrants = user.roles.filter((g) => STAFF_ROLES.includes(g.role));
  if (staffGrants.some((g) => g.campusId === null)) return null;
  return [...new Set(staffGrants.map((g) => g.campusId as string))];
}
