import { Body, Controller, Post } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { assertSchoolWide, SETUP_ROLES } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { dayStart } from '../common/dates.js';
import { CurrentUser, Permission, RequiresFeature, Roles } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { BCRYPT_ROUNDS } from '../auth/school-setup.service.js';
import { temporaryPassword } from '../platform/temp-password.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { checkStaffRows, staffRowSchema } from './staff-import.js';

// Each new login is hashed, so a sheet is capped well below the student import.
const importSchema = z.object({
  rows: z.array(staffRowSchema).min(1).max(200),
  /** false (default) only checks the rows. */
  commit: z.boolean().default(false),
});

/** Adds many staff at once from a spreadsheet: logins, employment details and salary. */
@Controller('hr/staff')
@Permission('hr')
@RequiresFeature('hr')
@Roles(...SETUP_ROLES)
export class StaffImportController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Checks every row, and with `commit` creates all of them or none. Each new
   * person gets a temporary password, returned once so it can be handed over.
   */
  @Post('import')
  async import(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(importSchema)) body: z.infer<typeof importSchema>,
  ) {
    assertSchoolWide(user, 'Only school-wide admins can import staff');
    const [users, profiles] = await Promise.all([
      this.prisma.user.findMany({ where: { schoolId: user.schoolId }, select: { email: true, phone: true } }),
      this.prisma.staffProfile.findMany({ where: { schoolId: user.schoolId }, select: { employeeNo: true } }),
    ]);
    const employeeNos = new Set(profiles.map((p) => p.employeeNo));
    const rows = checkStaffRows(body.rows, {
      emails: new Set(users.flatMap((u) => (u.email ? [u.email.toLowerCase()] : []))),
      phones: new Set(users.flatMap((u) => (u.phone ? [u.phone] : []))),
      employeeNos,
    });
    const invalid = rows.filter((r) => r.errors.length).length;
    const summary = {
      valid: rows.length - invalid,
      invalid,
      rows: rows.map(({ row, name, errors }) => ({ row, name, errors })),
    };
    if (!body.commit || invalid) return { ...summary, imported: 0, logins: [] };

    // Rows with their own employee numbers go first so a generated one never takes a number a later row asks for.
    const staff = rows.map((r) => r.staff!);
    for (const s of staff) if (s.employeeNo) employeeNos.add(s.employeeNo);
    let counter = profiles.length;
    const nextNo = () => {
      for (;;) {
        const candidate = `EMP-${String(++counter).padStart(4, '0')}`;
        if (!employeeNos.has(candidate)) {
          employeeNos.add(candidate);
          return candidate;
        }
      }
    };
    const prepared = await Promise.all(
      staff.map(async (s) => {
        const password = temporaryPassword();
        return { s, password, hash: await bcrypt.hash(password, BCRYPT_ROUNDS), employeeNo: s.employeeNo ?? nextNo() };
      }),
    );
    await this.prisma.$transaction(
      async (tx) => {
        for (const { s, hash, employeeNo } of prepared) {
          await tx.user.create({
            data: {
              schoolId: user.schoolId,
              name: s.name,
              email: s.email,
              phone: s.phone,
              passwordHash: hash,
              mustChangePassword: true,
              roles: { create: [{ role: s.role, campusId: null, customRoleId: null }] },
              staffProfile: {
                create: {
                  schoolId: user.schoolId,
                  employeeNo,
                  designation: s.designation,
                  department: s.department,
                  joinedOn: s.joinedOn ? dayStart(s.joinedOn.toISOString().slice(0, 10)) : null,
                  cnic: s.cnic,
                  basicSalary: s.basicSalary,
                  bankName: s.bankName,
                  bankAccount: s.bankAccount,
                },
              },
            },
          });
        }
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
    await this.audit.record(user, 'staff.import', 'User', null, { after: { count: prepared.length } });
    return {
      ...summary,
      imported: prepared.length,
      logins: prepared.map(({ s, password, employeeNo }) => ({
        name: s.name,
        employeeNo,
        login: s.email ?? s.phone,
        temporaryPassword: password,
      })),
    };
  }
}
