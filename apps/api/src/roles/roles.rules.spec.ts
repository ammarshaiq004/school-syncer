import { Role } from '@prisma/client';
import { DEFAULT_PERMISSIONS, type PermissionMatrix } from '../common/permissions.js';
import { copyName, delegationMessage, delegationViolations } from './roles.rules.js';

const admin = DEFAULT_PERMISSIONS[Role.ADMIN];
const teacher = DEFAULT_PERMISSIONS[Role.TEACHER];

describe('delegationViolations', () => {
  it('allows an editor with manage everywhere to grant anything', () => {
    const next: PermissionMatrix = { ...teacher, fees: 'manage', audit: 'manage' };
    expect(delegationViolations(admin, teacher, next)).toEqual([]);
  });

  it('refuses raising a module above the editor level', () => {
    const editor: PermissionMatrix = { ...admin, fees: 'view', audit: 'none' };
    const next: PermissionMatrix = { ...teacher, fees: 'manage', audit: 'view', exams: 'none' };
    expect(delegationViolations(editor, teacher, next)).toEqual(['fees', 'audit']);
  });

  it('allows keeping or lowering a level the editor does not hold', () => {
    const editor: PermissionMatrix = { ...admin, hr: 'none', library: 'view' };
    // Teachers already hold hr and library at manage; saving or lowering them is fine.
    const next: PermissionMatrix = { ...teacher, library: 'view' };
    expect(delegationViolations(editor, teacher, next)).toEqual([]);
  });

  it('names the modules in the message', () => {
    expect(delegationMessage(['fees', 'audit'])).toBe(
      'You cannot grant more access than you have: Fees, Audit log',
    );
  });
});

describe('copyName', () => {
  it('adds (copy) and then a number', () => {
    expect(copyName('Exam coordinator', [])).toBe('Exam coordinator (copy)');
    expect(copyName('Exam coordinator', ['exam coordinator (COPY)'])).toBe('Exam coordinator (copy 2)');
    expect(copyName('Exam coordinator', ['Exam coordinator (copy)', 'Exam coordinator (copy 2)'])).toBe(
      'Exam coordinator (copy 3)',
    );
  });

  it('stays within the name length limit', () => {
    expect(copyName('x'.repeat(80), []).length).toBeLessThanOrEqual(80);
  });
});
