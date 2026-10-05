import { Role } from '@prisma/client';
import {
  DEFAULT_PERMISSIONS,
  MODULE_KEYS,
  PERMISSION_MODULES,
  PERMISSION_GROUPS,
  builtinMatrix,
  clean,
  diffMatrix,
  effectiveLevel,
  effectivePermissions,
  overGranted,
  satisfies,
} from './permissions.js';

describe('permission catalog', () => {
  it('puts every module in a known group and every role in the default matrix', () => {
    for (const key of MODULE_KEYS) {
      expect(PERMISSION_GROUPS).toHaveProperty(PERMISSION_MODULES[key].group);
    }
    for (const role of Object.values(Role)) {
      expect(Object.keys(DEFAULT_PERMISSIONS[role]).sort()).toEqual([...MODULE_KEYS].sort());
    }
  });

  it('reproduces today: accountant manages fees, views reports, has no users access', () => {
    const m = DEFAULT_PERMISSIONS[Role.ACCOUNTANT];
    expect(m.fees).toBe('manage');
    expect(m.accounts).toBe('manage');
    expect(m.reports).toBe('view');
    expect(m.users).toBe('none');
    expect(DEFAULT_PERMISSIONS[Role.TEACHER].attendance).toBe('manage');
    expect(DEFAULT_PERMISSIONS[Role.ADMIN].users).toBe('manage');
  });

  it('gives teaching roles e-school manage, parents/students view, accountants and staff none', () => {
    for (const role of [Role.OWNER, Role.PRINCIPAL, Role.ADMIN, Role.TEACHER, Role.CLASS_TEACHER]) {
      expect(DEFAULT_PERMISSIONS[role].elearning).toBe('manage');
    }
    for (const role of [Role.STUDENT, Role.PARENT]) {
      expect(DEFAULT_PERMISSIONS[role].elearning).toBe('view');
    }
    expect(DEFAULT_PERMISSIONS[Role.ACCOUNTANT].elearning).toBe('none');
    expect(DEFAULT_PERMISSIONS[Role.STAFF].elearning).toBe('none');
  });

  it('gives gradebook and lesson plans to setup and teaching roles only', () => {
    for (const role of [Role.OWNER, Role.PRINCIPAL, Role.ADMIN, Role.TEACHER, Role.CLASS_TEACHER]) {
      expect(DEFAULT_PERMISSIONS[role].gradebook).toBe('manage');
      expect(DEFAULT_PERMISSIONS[role].lesson_plans).toBe('manage');
    }
    for (const role of [Role.ACCOUNTANT, Role.STAFF, Role.PARENT, Role.STUDENT]) {
      expect(DEFAULT_PERMISSIONS[role].gradebook).toBe('none');
      expect(DEFAULT_PERMISSIONS[role].lesson_plans).toBe('none');
    }
  });

  it('keeps running exams to exams=manage, so teachers only enter their own marks', () => {
    for (const role of [Role.OWNER, Role.PRINCIPAL, Role.ADMIN]) {
      expect(DEFAULT_PERMISSIONS[role].exams).toBe('manage');
    }
    for (const role of [Role.TEACHER, Role.CLASS_TEACHER, Role.STAFF]) {
      expect(DEFAULT_PERMISSIONS[role].exams).toBe('view');
    }
    // A custom role built on TEACHER with exams=manage runs exams, e.g. an
    // "Exam coordinator".
    const coordinator = effectiveLevel(
      [{ role: Role.TEACHER, customRoleId: 'cr1' }],
      { custom: { cr1: { baseRole: Role.TEACHER, permissions: { exams: 'manage' } } } },
      'exams',
    );
    expect(coordinator).toBe('manage');
  });

  it('lets teachers, parents and setup roles chat, others none', () => {
    // Setup roles keep manage so one who also teaches can answer parents; the
    // chat service still makes their safeguarding view of other threads read-only.
    for (const role of [Role.TEACHER, Role.CLASS_TEACHER, Role.PARENT, Role.OWNER, Role.PRINCIPAL, Role.ADMIN]) {
      expect(DEFAULT_PERMISSIONS[role].chat).toBe('manage');
    }
    for (const role of [Role.ACCOUNTANT, Role.STAFF, Role.STUDENT]) {
      expect(DEFAULT_PERMISSIONS[role].chat).toBe('none');
    }
  });

  it('orders levels none < view < manage', () => {
    expect(satisfies('manage', 'view')).toBe(true);
    expect(satisfies('view', 'manage')).toBe(false);
    expect(satisfies('none', 'view')).toBe(false);
    expect(satisfies('none', 'none')).toBe(true);
  });
});

describe('effectiveLevel', () => {
  it('gives OWNER manage everywhere, even with stored edits', () => {
    const all = effectiveLevel([{ role: Role.OWNER }], { builtin: { OWNER: { fees: 'none' } } });
    expect(Object.values(all).every((l) => l === 'manage')).toBe(true);
  });

  it('applies built-in role edits over the defaults', () => {
    const overrides = { builtin: { ACCOUNTANT: { accounts: 'view' as const, audit: 'view' as const } } };
    expect(effectiveLevel([{ role: Role.ACCOUNTANT }], overrides, 'accounts')).toBe('view');
    expect(effectiveLevel([{ role: Role.ACCOUNTANT }], overrides, 'audit')).toBe('view');
    expect(effectiveLevel([{ role: Role.ACCOUNTANT }], overrides, 'fees')).toBe('manage');
  });

  it('takes the highest level across grants', () => {
    const grants = [{ role: Role.TEACHER }, { role: Role.ACCOUNTANT }];
    expect(effectiveLevel(grants, {}, 'fees')).toBe('manage');
    expect(effectiveLevel(grants, {}, 'attendance')).toBe('manage');
    expect(effectiveLevel(grants, {}, 'users')).toBe('none');
  });

  it('uses a custom role map and falls back to its base role for unmentioned modules', () => {
    const overrides = {
      builtin: { TEACHER: { library: 'view' as const } },
      custom: {
        cr1: { baseRole: Role.TEACHER, permissions: { exams: 'manage', attendance: 'none' } as const },
      },
    };
    const grant = [{ role: Role.TEACHER, customRoleId: 'cr1' }];
    expect(effectiveLevel(grant, overrides, 'exams')).toBe('manage');
    expect(effectiveLevel(grant, overrides, 'attendance')).toBe('none');
    expect(effectiveLevel(grant, overrides, 'library')).toBe('view');
    expect(effectiveLevel(grant, overrides, 'students')).toBe('view');
  });

  it('falls back to the grant role when the custom role is unknown', () => {
    expect(effectiveLevel([{ role: Role.TEACHER, customRoleId: 'gone' }], {}, 'attendance')).toBe('manage');
  });

  it('gives nothing with no grants and ignores junk in stored Json', () => {
    expect(effectiveLevel([], {}, 'dashboard')).toBe('none');
    const junk = { builtin: { STAFF: { fees: 'admin', nope: 'manage' } as never } };
    expect(builtinMatrix(Role.STAFF, junk)).toEqual(DEFAULT_PERMISSIONS[Role.STAFF]);
    expect(clean(['x'])).toEqual({});
  });

  it('effectivePermissions and effectiveLevel agree', () => {
    const grants = [{ role: Role.STAFF }];
    expect(effectiveLevel(grants)).toEqual(effectivePermissions(grants));
  });
});

describe('storage and delegation helpers', () => {
  it('diffMatrix keeps only changed modules', () => {
    const base = DEFAULT_PERMISSIONS[Role.TEACHER];
    expect(diffMatrix(base, { attendance: 'manage', fees: 'none', users: 'none' })).toEqual({ fees: 'none' });
  });

  it('overGranted lists modules above the editor level', () => {
    const editor = DEFAULT_PERMISSIONS[Role.ACCOUNTANT];
    expect(overGranted(editor, { fees: 'manage', users: 'view', reports: 'manage' })).toEqual(['users', 'reports']);
    expect(overGranted(DEFAULT_PERMISSIONS[Role.OWNER], { users: 'manage' })).toEqual([]);
  });
});
