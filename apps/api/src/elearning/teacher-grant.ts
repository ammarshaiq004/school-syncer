import type { Prisma } from '@prisma/client';
import { ATTENDANCE_ROLES, campusScope } from '../common/admin-roles.js';
import type { AuthUser } from '../common/auth-user.js';

/**
 * Role grant filter for "a teacher this user may assign": a teaching or setup
 * role, and for a campus-limited admin only one granted school-wide or at one
 * of their campuses, so they cannot hand a section to another campus's staff.
 */
export function teacherGrantInScope(user: AuthUser): Prisma.RoleAssignmentWhereInput {
  const scope = campusScope(user);
  return {
    role: { in: ATTENDANCE_ROLES },
    ...(scope ? { OR: [{ campusId: null }, { campusId: { in: scope } }] } : {}),
  };
}
