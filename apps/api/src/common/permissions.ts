import { Role } from '@prisma/client';

/**
 * School permission catalog: the module layer that sits under the @Roles
 * ceiling. @Roles decides whether a built-in role may reach an endpoint at
 * all; the matrix here can only narrow that further (deny-capable), never
 * widen it. Pure data and pure functions, no Nest or Prisma access.
 */

export const ACCESS_LEVELS = ['none', 'view', 'manage'] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

export const isAccessLevel = (value: unknown): value is AccessLevel =>
  typeof value === 'string' && (ACCESS_LEVELS as readonly string[]).includes(value);

const RANK: Record<AccessLevel, number> = { none: 0, view: 1, manage: 2 };

/** True when `have` is at least `need`. */
export const satisfies = (have: AccessLevel, need: AccessLevel): boolean =>
  RANK[have] >= RANK[need];

export const maxLevel = (a: AccessLevel, b: AccessLevel): AccessLevel =>
  RANK[a] >= RANK[b] ? a : b;

export const PERMISSION_GROUPS = {
  overview: 'Overview',
  students: 'Students',
  academics: 'Academics',
  finance: 'Finance',
  operations: 'Operations',
  communication: 'Communication',
  setup: 'Setup',
} as const;

export type PermissionGroup = keyof typeof PERMISSION_GROUPS;

/**
 * Every module, in display order. Later releases append keys (gradebook,
 * lesson_plans, chat); stored matrices without them fall back to
 * DEFAULT_PERMISSIONS, so no data migration is needed.
 */
export const PERMISSION_MODULES = {
  dashboard: { label: 'Dashboard', group: 'overview' },
  students: { label: 'Students', group: 'students' },
  admissions: { label: 'Admissions', group: 'students' },
  attendance: { label: 'Attendance', group: 'students' },
  promotions: { label: 'Promotions', group: 'students' },
  certificates: { label: 'Certificates and ID cards', group: 'students' },
  timetable: { label: 'Timetable', group: 'academics' },
  homework: { label: 'Homework', group: 'academics' },
  exams: { label: 'Exams and results', group: 'academics' },
  elearning: { label: 'E-school', group: 'academics' },
  fees: { label: 'Fees', group: 'finance' },
  accounts: { label: 'Accounts', group: 'finance' },
  reports: { label: 'Reports', group: 'finance' },
  billing: { label: 'SchoolSyncer billing', group: 'finance' },
  hr: { label: 'HR and payroll', group: 'operations' },
  transport: { label: 'Transport', group: 'operations' },
  library: { label: 'Library', group: 'operations' },
  announcements: { label: 'Announcements', group: 'communication' },
  messages: { label: 'Messages and notifications', group: 'communication' },
  campuses: { label: 'Campuses', group: 'setup' },
  classes: { label: 'Classes and subjects', group: 'setup' },
  users: { label: 'Users and roles', group: 'setup' },
  settings: { label: 'School settings', group: 'setup' },
  audit: { label: 'Audit log', group: 'setup' },
} as const satisfies Record<string, { label: string; group: PermissionGroup }>;

export type PermissionModule = keyof typeof PERMISSION_MODULES;

export const MODULE_KEYS = Object.keys(PERMISSION_MODULES) as PermissionModule[];

export const isPermissionModule = (value: unknown): value is PermissionModule =>
  typeof value === 'string' && Object.hasOwn(PERMISSION_MODULES, value);

/** Human label for messages such as "Your role does not have access to Fees". */
export const moduleLabel = (module: PermissionModule): string =>
  PERMISSION_MODULES[module].label;

export type PermissionMatrix = Record<PermissionModule, AccessLevel>;
/** What is stored in Json columns: only the modules that differ. */
export type PartialMatrix = Partial<Record<PermissionModule, AccessLevel>>;

/** Built-in roles a school may edit. OWNER is always manage everywhere. */
export const EDITABLE_BUILTIN_ROLES: Role[] = [
  Role.PRINCIPAL,
  Role.ADMIN,
  Role.ACCOUNTANT,
  Role.TEACHER,
  Role.CLASS_TEACHER,
  Role.STAFF,
];

/** Roles a custom role may build on (not OWNER, PARENT or STUDENT; also a DB CHECK). */
export const CUSTOM_ROLE_BASES: Role[] = EDITABLE_BUILTIN_ROLES;

function matrix(fill: AccessLevel, levels: PartialMatrix = {}): PermissionMatrix {
  const out = {} as PermissionMatrix;
  for (const key of MODULE_KEYS) out[key] = levels[key] ?? fill;
  return out;
}

/** Teaching roles: today they reach these through STAFF_ROLES / ATTENDANCE_ROLES. */
const TEACHING: PartialMatrix = {
  dashboard: 'view',
  students: 'view',
  attendance: 'manage',
  certificates: 'view',
  timetable: 'view',
  homework: 'manage',
  exams: 'manage', // marks entry and remarks
  elearning: 'manage', // courses, live classes, assignments, quizzes
  fees: 'view', // fee heads and structures
  hr: 'manage', // own leave requests and payslips
  transport: 'view',
  library: 'manage', // circulation is open to all staff
  announcements: 'view',
  campuses: 'view',
  classes: 'view',
  settings: 'view',
};

/**
 * Default matrix per built-in role. Each entry is the highest level the role
 * reaches in that module through today's @Roles annotations, so applying the
 * defaults changes nothing. Self-service endpoints that every staff role uses
 * (leave requests, own payslips, own timetable) sit in modules the staff roles
 * hold at manage/view, so they keep working.
 */
export const DEFAULT_PERMISSIONS: Record<Role, PermissionMatrix> = {
  [Role.OWNER]: matrix('manage'),
  [Role.PRINCIPAL]: matrix('manage'),
  [Role.ADMIN]: matrix('manage'),
  [Role.ACCOUNTANT]: matrix('none', {
    dashboard: 'view',
    students: 'view',
    attendance: 'view',
    certificates: 'view',
    timetable: 'view',
    homework: 'view',
    exams: 'view',
    fees: 'manage',
    accounts: 'manage',
    reports: 'view',
    billing: 'view',
    hr: 'manage', // payroll
    transport: 'view',
    library: 'manage',
    announcements: 'view',
    campuses: 'view',
    classes: 'view',
    settings: 'view',
  }),
  [Role.TEACHER]: matrix('none', TEACHING),
  [Role.CLASS_TEACHER]: matrix('none', TEACHING),
  [Role.STAFF]: matrix('none', {
    ...TEACHING,
    attendance: 'view',
    homework: 'view',
    exams: 'view',
    elearning: 'none', // e-school is for teaching staff
  }),
  // Parents and students are not editable; their endpoints are fenced by
  // @Roles and by ownership checks, the matrix only has to let them through.
  [Role.PARENT]: matrix('none', {
    dashboard: 'view',
    students: 'view',
    attendance: 'view',
    timetable: 'view',
    homework: 'view',
    exams: 'view',
    elearning: 'view',
    fees: 'view',
    transport: 'view',
    library: 'view',
    announcements: 'view',
    messages: 'view',
    campuses: 'view',
    classes: 'view',
    settings: 'view',
  }),
  [Role.STUDENT]: matrix('none', {
    dashboard: 'view',
    attendance: 'view',
    timetable: 'view',
    homework: 'view',
    exams: 'view',
    elearning: 'view',
    fees: 'view',
    library: 'view',
    announcements: 'view',
    messages: 'view',
    campuses: 'view',
    classes: 'view',
    settings: 'view',
  }),
};

/** A role grant as the permission layer sees it (campus does not matter here). */
export interface PermissionGrant {
  role: Role;
  customRoleId?: string | null;
}

/** A school's stored edits, as loaded from BuiltinRolePermission and CustomRole. */
export interface PermissionOverrides {
  builtin?: Partial<Record<Role, PartialMatrix>>;
  custom?: Record<string, { baseRole: Role; permissions: PartialMatrix }>;
}

/** The school's matrix for one built-in role: defaults plus its edits. */
export function builtinMatrix(role: Role, overrides: PermissionOverrides = {}): PermissionMatrix {
  const defaults = DEFAULT_PERMISSIONS[role];
  if (role === Role.OWNER || !EDITABLE_BUILTIN_ROLES.includes(role)) return { ...defaults };
  return { ...defaults, ...clean(overrides.builtin?.[role]) };
}

/**
 * The matrix for one grant. A custom role uses its own map; modules it does
 * not mention fall back to its base role's (school-edited) matrix. A grant
 * naming an unknown custom role falls back to the base role alone.
 */
export function grantMatrix(grant: PermissionGrant, overrides: PermissionOverrides = {}): PermissionMatrix {
  const custom = grant.customRoleId ? overrides.custom?.[grant.customRoleId] : undefined;
  const base = builtinMatrix(custom?.baseRole ?? grant.role, overrides);
  return custom ? { ...base, ...clean(custom.permissions) } : base;
}

/** Effective level per module: the highest level across all of a user's grants. */
export function effectivePermissions(
  grants: PermissionGrant[],
  overrides: PermissionOverrides = {},
): PermissionMatrix {
  const out = matrix('none');
  for (const grant of grants) {
    const m = grantMatrix(grant, overrides);
    for (const key of MODULE_KEYS) out[key] = maxLevel(out[key], m[key]);
  }
  return out;
}

/** Effective level for one module (max across grants), or the whole matrix when no module is given. */
export function effectiveLevel(
  grants: PermissionGrant[],
  overrides: PermissionOverrides,
  module: PermissionModule,
): AccessLevel;
export function effectiveLevel(grants: PermissionGrant[], overrides?: PermissionOverrides): PermissionMatrix;
export function effectiveLevel(
  grants: PermissionGrant[],
  overrides: PermissionOverrides = {},
  module?: PermissionModule,
): AccessLevel | PermissionMatrix {
  const all = effectivePermissions(grants, overrides);
  return module ? all[module] : all;
}

/** Keeps only known modules with valid levels (stored Json is untrusted). */
export function clean(value: unknown): PartialMatrix {
  const out: PartialMatrix = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [key, level] of Object.entries(value)) {
    if (isPermissionModule(key) && isAccessLevel(level)) out[key] = level;
  }
  return out;
}

/** The modules where `matrix` differs from `base`, for sparse storage. */
export function diffMatrix(base: PermissionMatrix, next: PartialMatrix): PartialMatrix {
  const out: PartialMatrix = {};
  for (const [key, level] of Object.entries(clean(next)) as [PermissionModule, AccessLevel][]) {
    if (base[key] !== level) out[key] = level;
  }
  return out;
}

/**
 * Delegation rule: an editor may not grant any module a level above their own.
 * Returns the modules that would be over-granted (empty = allowed).
 */
export function overGranted(editor: PermissionMatrix, requested: PartialMatrix): PermissionModule[] {
  return (Object.entries(clean(requested)) as [PermissionModule, AccessLevel][])
    .filter(([key, level]) => !satisfies(editor[key], level))
    .map(([key]) => key);
}
