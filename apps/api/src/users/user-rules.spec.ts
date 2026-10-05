import { Role } from '@prisma/client';
import {
  addedGrants,
  campusScopeViolation,
  hasDuplicateGrant,
  ownerRuleViolation,
  userListWhere,
  type StoredGrant,
} from './user-rules.js';

const g = (role: Role, campusId: string | null = null, customRoleId: string | null = null): StoredGrant => ({
  role,
  campusId,
  customRoleId,
});

describe('user rules', () => {
  it('spots duplicate grants by role, campus and custom role', () => {
    expect(hasDuplicateGrant([g(Role.TEACHER), g(Role.TEACHER, 'c1')])).toBe(false);
    expect(hasDuplicateGrant([g(Role.TEACHER), g(Role.TEACHER, null, 'cr1')])).toBe(false);
    expect(hasDuplicateGrant([g(Role.TEACHER, 'c1'), g(Role.TEACHER, 'c1')])).toBe(true);
  });

  it('keeps campus-scoped editors on their own campuses', () => {
    expect(campusScopeViolation(null, [g(Role.PRINCIPAL)])).toBe(false);
    expect(campusScopeViolation(['c1'], [g(Role.TEACHER, 'c1')])).toBe(false);
    expect(campusScopeViolation(['c1'], [g(Role.TEACHER, 'c2')])).toBe(true);
    // A school-wide grant reaches every campus.
    expect(campusScopeViolation(['c1'], [g(Role.TEACHER, 'c1'), g(Role.ACCOUNTANT)])).toBe(true);
    // Parent grants have no campus and do not count.
    expect(campusScopeViolation(['c1'], [g(Role.TEACHER, 'c1'), g(Role.PARENT)])).toBe(false);
  });

  it('narrows the user list to the campus scope and one id', () => {
    expect(userListWhere('s1', {}, ['c1'], 'u1')).toEqual({
      AND: [{ schoolId: 's1' }, { id: 'u1' }, { roles: { some: { campusId: { in: ['c1'] } } } }],
    });
  });

  it('lists only grants the user did not hold', () => {
    const before = [g(Role.TEACHER), g(Role.STAFF, 'c1')];
    expect(addedGrants(before, [g(Role.TEACHER), g(Role.ADMIN)])).toEqual([g(Role.ADMIN)]);
    expect(addedGrants(before, [g(Role.TEACHER, null, 'cr1')])).toEqual([g(Role.TEACHER, null, 'cr1')]);
    expect(addedGrants(before, before)).toEqual([]);
  });

  it('lets only owners make owners or touch owner accounts', () => {
    expect(ownerRuleViolation({ editorIsOwner: true, targetGrants: [g(Role.OWNER)], nextGrants: [g(Role.OWNER)] })).toBeNull();
    expect(ownerRuleViolation({ editorIsOwner: false, nextGrants: [g(Role.OWNER)] })).toMatch(/make someone an owner/);
    expect(ownerRuleViolation({ editorIsOwner: false, targetGrants: [g(Role.OWNER), g(Role.TEACHER)] })).toMatch(
      /change an owner account/,
    );
    expect(ownerRuleViolation({ editorIsOwner: false, targetGrants: [g(Role.ADMIN)], nextGrants: [g(Role.TEACHER)] })).toBeNull();
  });

  it('always scopes the user list to the school and adds only given filters', () => {
    expect(userListWhere('s1', {})).toEqual({ AND: [{ schoolId: 's1' }] });
    const where = userListWhere('s1', {
      search: ' ayesha ',
      status: 'inactive',
      role: Role.TEACHER,
      campusId: 'c1',
      customRoleId: 'cr1',
      type: 'staff',
    });
    const and = where.AND as object[];
    expect(and[0]).toEqual({ schoolId: 's1' });
    expect(JSON.stringify(and[1])).toContain('"contains":"ayesha"');
    expect(and).toContainEqual({ isActive: false });
    expect(and).toContainEqual({ roles: { some: { role: Role.TEACHER } } });
    expect(and).toContainEqual({ roles: { some: { campusId: 'c1' } } });
    expect(and).toContainEqual({ roles: { some: { customRoleId: 'cr1' } } });
    expect(and).toHaveLength(7);
    expect(userListWhere('s1', { status: 'all', search: '  ' })).toEqual({ AND: [{ schoolId: 's1' }] });
  });
});
