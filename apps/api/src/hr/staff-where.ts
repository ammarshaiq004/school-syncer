import type { Prisma } from '@prisma/client';
import { STAFF_ROLES } from '../common/admin-roles.js';

/**
 * Anyone holding a staff role, as opposed to parents and students. With a
 * campus scope, only staff holding a grant on one of those campuses (the
 * same people the users screen shows a campus-limited admin).
 */
export const staffWhere = (schoolId: string, scope: string[] | null = null): Prisma.UserWhereInput => ({
  schoolId,
  AND: [
    { roles: { some: { role: { in: STAFF_ROLES } } } },
    ...(scope ? [{ roles: { some: { campusId: { in: scope } } } }] : []),
  ],
});
