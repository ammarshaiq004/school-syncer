import { Role } from '@prisma/client';
import {
  MODULE_KEYS,
  moduleLabel,
  overGranted,
  satisfies,
  type PartialMatrix,
  type PermissionMatrix,
  type PermissionModule,
} from '../common/permissions.js';

/** Display names for the built-in roles (the web uses the same wording). */
export const ROLE_LABELS: Record<Role, string> = {
  [Role.OWNER]: 'Owner',
  [Role.PRINCIPAL]: 'Principal',
  [Role.ADMIN]: 'Administrator',
  [Role.ACCOUNTANT]: 'Accountant',
  [Role.TEACHER]: 'Teacher',
  [Role.CLASS_TEACHER]: 'Class teacher',
  [Role.STAFF]: 'Staff',
  [Role.PARENT]: 'Parent',
  [Role.STUDENT]: 'Student',
};

/**
 * Delegation rule: an editor cannot hand out more than they hold. Only the
 * modules the change actually raises are checked, so an editor may still save
 * a matrix that already held (and keeps) a level above their own.
 * Returns the offending modules (empty = allowed).
 */
export function delegationViolations(
  editor: PermissionMatrix,
  current: PermissionMatrix,
  next: PermissionMatrix,
): PermissionModule[] {
  const raised: PartialMatrix = {};
  for (const key of MODULE_KEYS) {
    if (!satisfies(current[key], next[key])) raised[key] = next[key];
  }
  return overGranted(editor, raised);
}

export function delegationMessage(modules: PermissionModule[]): string {
  return `You cannot grant more access than you have: ${modules.map(moduleLabel).join(', ')}`;
}

/** "Exam coordinator (copy)", then "(copy 2)", ... avoiding names already taken (case-insensitive). */
export function copyName(name: string, taken: string[]): string {
  const used = new Set(taken.map((n) => n.toLowerCase()));
  const stem = name.slice(0, 64).trim();
  const base = `${stem} (copy)`;
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const candidate = `${stem} (copy ${n})`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}
