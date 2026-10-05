import { Prisma, Role } from '@prisma/client';
import { STAFF_ROLES } from '../common/admin-roles.js';

/** A grant as stored on RoleAssignment. */
export interface StoredGrant {
  role: Role;
  campusId: string | null;
  customRoleId: string | null;
}

export const grantKey = (g: StoredGrant) => `${g.role}|${g.campusId ?? ''}|${g.customRoleId ?? ''}`;

/** True when the same grant (role, campus, custom role) appears twice. */
export function hasDuplicateGrant(grants: StoredGrant[]): boolean {
  return new Set(grants.map(grantKey)).size !== grants.length;
}

/** Grants in `next` the user did not already hold. */
export function addedGrants(before: StoredGrant[], next: StoredGrant[]): StoredGrant[] {
  const had = new Set(before.map(grantKey));
  return next.filter((g) => !had.has(grantKey(g)));
}

export const holdsOwner = (grants: { role: Role }[]) => grants.some((g) => g.role === Role.OWNER);

/**
 * Owner rules shared by create, edit, deactivate and reset-password: only an
 * owner may make someone an owner, and only an owner may touch an owner's
 * account (otherwise an admin could reset the owner's password and sign in
 * as them). Returns the refusal message, or null when allowed.
 */
export function ownerRuleViolation(input: {
  editorIsOwner: boolean;
  targetGrants?: { role: Role }[];
  nextGrants?: { role: Role }[];
}): string | null {
  if (input.editorIsOwner) return null;
  if (input.targetGrants && holdsOwner(input.targetGrants)) {
    return 'Only an owner can change an owner account';
  }
  if (input.nextGrants && holdsOwner(input.nextGrants)) {
    return 'Only an owner can make someone an owner';
  }
  return null;
}

export const USER_STATUSES = ['active', 'inactive', 'all'] as const;
export type UserStatusFilter = (typeof USER_STATUSES)[number];

export interface UserListFilters {
  search?: string;
  role?: Role;
  customRoleId?: string;
  status?: UserStatusFilter;
  campusId?: string;
  /** 'staff' keeps people holding at least one staff role (not parents/students). */
  type?: 'staff' | 'all';
}

/**
 * True when `grants` include a staff grant outside a campus-scoped editor's
 * campuses (a school-wide grant, campusId null, counts as outside). Always
 * false for an unscoped editor (scope null).
 */
export function campusScopeViolation(
  scope: string[] | null,
  grants: { role: Role; campusId: string | null }[],
): boolean {
  if (!scope) return false;
  return grants.some((g) => STAFF_ROLES.includes(g.role) && (g.campusId === null || !scope.includes(g.campusId)));
}

/**
 * The Prisma filter for GET /users, always scoped to the caller's school.
 * With a campus scope, only people holding a grant on one of those campuses
 * are visible. `id` narrows it to one person (for get / edit lookups).
 */
export function userListWhere(
  schoolId: string,
  f: UserListFilters,
  scope: string[] | null = null,
  id?: string,
): Prisma.UserWhereInput {
  const and: Prisma.UserWhereInput[] = [{ schoolId }];
  if (id) and.push({ id });
  if (scope) and.push({ roles: { some: { campusId: { in: scope } } } });
  const search = f.search?.trim();
  if (search) {
    const contains = { contains: search, mode: Prisma.QueryMode.insensitive };
    and.push({
      OR: [
        { name: contains },
        { email: contains },
        { phone: { contains: search } },
        { staffProfile: { is: { designation: contains } } },
        { staffProfile: { is: { employeeNo: contains } } },
      ],
    });
  }
  if (f.status === 'active') and.push({ isActive: true });
  if (f.status === 'inactive') and.push({ isActive: false });
  if (f.role) and.push({ roles: { some: { role: f.role } } });
  if (f.customRoleId) and.push({ roles: { some: { customRoleId: f.customRoleId } } });
  if (f.campusId) and.push({ roles: { some: { campusId: f.campusId } } });
  if (f.type === 'staff') and.push({ roles: { some: { role: { in: STAFF_ROLES } } } });
  return { AND: and };
}
