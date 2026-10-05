import type { AccessLevel, PermissionModule, Role } from "@/lib/api";

/** A role grant as GET /users returns it. */
export interface StaffGrant {
  id: string;
  role: Role;
  campusId: string | null;
  customRoleId: string | null;
  campus: { id: string; name: string } | null;
  customRole: { id: string; name: string } | null;
}

/** A role grant as POST/PATCH /users accept it. */
export interface GrantInput {
  role?: Role;
  campusId: string | null;
  customRoleId?: string | null;
}

export interface StaffUser {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  staffProfile: {
    employeeNo: string;
    designation: string;
    department: string | null;
    status: string;
  } | null;
  roles: StaffGrant[];
}

/** GET /users/:id: the profile drawer. */
export interface StaffDetail extends StaffUser {
  staffProfile: (NonNullable<StaffUser["staffProfile"]> & { joinedOn: string | null }) | null;
  load?: { timetablePeriods: number; classTeacherOf: number; subjectsTaught: number };
}

export interface Campus {
  id: string;
  name: string;
}

/** Built-in roles in display order, with the names the API uses. */
export const ROLE_NAMES: Record<Role, string> = {
  OWNER: "Owner",
  PRINCIPAL: "Principal",
  ADMIN: "Administrator",
  ACCOUNTANT: "Accountant",
  TEACHER: "Teacher",
  CLASS_TEACHER: "Class teacher",
  STAFF: "Staff",
  PARENT: "Parent",
  STUDENT: "Student",
};

/** Roles a staff member can hold (OWNER only offered to owners). */
export const STAFF_ROLES: Role[] = ["OWNER", "PRINCIPAL", "ADMIN", "ACCOUNTANT", "TEACHER", "CLASS_TEACHER", "STAFF"];

/** Roles a custom role can be based on. */
export const CUSTOM_ROLE_BASES: Role[] = ["PRINCIPAL", "ADMIN", "ACCOUNTANT", "TEACHER", "CLASS_TEACHER", "STAFF"];

export const grantName = (g: Pick<StaffGrant, "role" | "customRole">) => g.customRole?.name ?? ROLE_NAMES[g.role] ?? g.role;

/* ---------------- /roles API ---------------- */

export type Matrix = Record<PermissionModule, AccessLevel>;
export type PartialMatrix = Partial<Matrix>;

export interface BuiltinRole {
  role: Role;
  name: string;
  editable: boolean;
  permissions: Matrix;
  defaults: Matrix;
  customized: boolean;
  memberCount: number;
}

export interface CustomRole {
  id: string;
  name: string;
  description: string | null;
  baseRole: Role;
  baseRoleName: string;
  permissions: Matrix;
  overrides: PartialMatrix;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface RolesResponse {
  builtin: BuiltinRole[];
  custom: CustomRole[];
}

export interface ModuleCatalog {
  levels: AccessLevel[];
  groups: { key: string; label: string; modules: { key: PermissionModule; label: string }[] }[];
  modules: { key: PermissionModule; label: string; group: string }[];
}
