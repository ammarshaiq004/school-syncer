import type { PrismaClient } from '@prisma/client';
import { nameKey, normalizeCnic, normalizePhone } from '../common/identity.js';

/**
 * Brings phone numbers, CNICs and B-Forms saved before SCHOOL-123 into the
 * canonical form every write now uses (see common/identity.ts). Rows that
 * cannot be normalised, or whose normal form clashes with another row, are
 * left as they are and reported, never guessed at. Safe to run again.
 */

export interface CleanupProblem {
  table: 'Guardian' | 'User' | 'Student' | 'StaffProfile' | 'Application';
  id: string;
  schoolId: string;
  field: string;
  value: string;
  reason: string;
}

export interface CleanupReport {
  /** Rows changed (or that would change, on a dry run), per table and field. */
  fixed: Record<string, number>;
  /** Guardians saved twice under two spellings of one number, merged into one. */
  mergedGuardians: number;
  problems: CleanupProblem[];
}

type Fix = (value: string) => string | undefined;

const NOT_MOBILE = 'Not a Pakistani mobile number';
const NOT_13 = 'Not 13 digits';

export async function normaliseContacts(
  prisma: PrismaClient,
  opts: { apply: boolean; /** Only this school (default every school). */ schoolId?: string },
): Promise<CleanupReport> {
  const report: CleanupReport = { fixed: {}, mergedGuardians: 0, problems: [] };
  const school = opts.schoolId ? { schoolId: opts.schoolId } : {};
  const count = (key: string) => (report.fixed[key] = (report.fixed[key] ?? 0) + 1);

  await guardianPhones(prisma, school, opts.apply, report, count);
  await userPhones(prisma, school, opts.apply, report, count);

  // Plain columns with no uniqueness: fix what can be fixed, report the rest.
  const simple: {
    table: CleanupProblem['table'];
    field: string;
    fix: Fix;
    reason: string;
    rows: () => Promise<{ id: string; schoolId: string; value: string | null }[]>;
    save: (id: string, value: string) => Promise<unknown>;
  }[] = [
    {
      table: 'Guardian',
      field: 'cnic',
      fix: normalizeCnic,
      reason: NOT_13,
      rows: async () =>
        (await prisma.guardian.findMany({ where: { ...school, cnic: { not: null } }, select: { id: true, schoolId: true, cnic: true } })).map(
          (r) => ({ id: r.id, schoolId: r.schoolId, value: r.cnic }),
        ),
      save: (id, cnic) => prisma.guardian.update({ where: { id }, data: { cnic } }),
    },
    {
      table: 'Student',
      field: 'bFormNo',
      fix: normalizeCnic,
      reason: NOT_13,
      rows: async () =>
        (
          await prisma.student.findMany({ where: { ...school, bFormNo: { not: null } }, select: { id: true, schoolId: true, bFormNo: true } })
        ).map((r) => ({ id: r.id, schoolId: r.schoolId, value: r.bFormNo })),
      save: (id, bFormNo) => prisma.student.update({ where: { id }, data: { bFormNo } }),
    },
    {
      table: 'StaffProfile',
      field: 'cnic',
      fix: normalizeCnic,
      reason: NOT_13,
      rows: async () =>
        (
          await prisma.staffProfile.findMany({ where: { ...school, cnic: { not: null } }, select: { id: true, schoolId: true, cnic: true } })
        ).map((r) => ({ id: r.id, schoolId: r.schoolId, value: r.cnic })),
      save: (id, cnic) => prisma.staffProfile.update({ where: { id }, data: { cnic } }),
    },
    {
      table: 'Application',
      field: 'guardianPhone',
      fix: normalizePhone,
      reason: NOT_MOBILE,
      rows: async () =>
        (await prisma.application.findMany({ where: school, select: { id: true, schoolId: true, guardianPhone: true } })).map((r) => ({
          id: r.id,
          schoolId: r.schoolId,
          value: r.guardianPhone,
        })),
      save: (id, guardianPhone) => prisma.application.update({ where: { id }, data: { guardianPhone } }),
    },
  ];
  for (const col of simple) {
    for (const row of await col.rows()) {
      if (!row.value) continue;
      const fixed = col.fix(row.value);
      if (fixed === undefined) {
        report.problems.push({ table: col.table, id: row.id, schoolId: row.schoolId, field: col.field, value: row.value, reason: col.reason });
      } else if (fixed !== row.value) {
        count(`${col.table}.${col.field}`);
        if (opts.apply) await col.save(row.id, fixed);
      }
    }
  }
  return report;
}

/**
 * Guardian phones are unique per school, so two spellings of one number can
 * be two guardians. Those are merged when they have the same name and at
 * most one parent login; otherwise both are reported.
 */
async function guardianPhones(
  prisma: PrismaClient,
  school: { schoolId?: string },
  apply: boolean, report: CleanupReport, count: (k: string) => void) {
  const guardians = await prisma.guardian.findMany({
    where: school,
    select: { id: true, schoolId: true, name: true, phone: true, email: true, cnic: true, occupation: true, userId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  const groups = new Map<string, typeof guardians>();
  for (const g of guardians) {
    const phone = normalizePhone(g.phone);
    if (!phone) {
      report.problems.push({ table: 'Guardian', id: g.id, schoolId: g.schoolId, field: 'phone', value: g.phone, reason: NOT_MOBILE });
      continue;
    }
    const key = `${g.schoolId}|${phone}`;
    groups.set(key, [...(groups.get(key) ?? []), g]);
  }
  for (const [key, group] of groups) {
    const phone = key.split('|')[1];
    if (group.length === 1) {
      if (group[0].phone === phone) continue;
      count('Guardian.phone');
      if (apply) await prisma.guardian.update({ where: { id: group[0].id }, data: { phone } });
      continue;
    }
    const names = new Set(group.map((g) => nameKey(g.name)));
    const logins = group.filter((g) => g.userId);
    if (names.size > 1 || logins.length > 1) {
      for (const g of group) {
        report.problems.push({
          table: 'Guardian',
          id: g.id,
          schoolId: g.schoolId,
          field: 'phone',
          value: g.phone,
          reason: `Same number as ${group
            .filter((o) => o !== g)
            .map((o) => `"${o.name}" (${o.phone})`)
            .join(', ')}${names.size > 1 ? ' under another name' : ', and both have a parent login'}; merge them by hand`,
        });
      }
      continue;
    }
    // Keep the one with the login, else the one already in canonical form, else the oldest.
    const keep = logins[0] ?? group.find((g) => g.phone === phone) ?? group[0];
    const drop = group.filter((g) => g !== keep);
    report.mergedGuardians += drop.length;
    count('Guardian.phone');
    if (!apply) continue;
    await prisma.$transaction(async (tx) => {
      for (const d of drop) {
        const links = await tx.studentGuardian.findMany({ where: { guardianId: d.id } });
        for (const l of links) {
          const already = await tx.studentGuardian.findUnique({
            where: { studentId_guardianId: { studentId: l.studentId, guardianId: keep.id } },
          });
          if (!already) {
            await tx.studentGuardian.create({ data: { ...l, guardianId: keep.id } });
          } else if (l.isPrimary && !already.isPrimary) {
            await tx.studentGuardian.update({
              where: { studentId_guardianId: { studentId: l.studentId, guardianId: keep.id } },
              data: { isPrimary: true },
            });
          }
        }
        // Chat threads and the like follow the parent's login (User), which stays on `keep`.
        await tx.guardian.delete({ where: { id: d.id } });
      }
      await tx.guardian.update({
        where: { id: keep.id },
        data: {
          phone,
          email: keep.email ?? drop.find((d) => d.email)?.email,
          cnic: keep.cnic ?? drop.find((d) => d.cnic)?.cnic,
          occupation: keep.occupation ?? drop.find((d) => d.occupation)?.occupation,
        },
      });
    });
  }
}

/** Login phones; a clash with another login at the school is reported, never merged. */
async function userPhones(
  prisma: PrismaClient,
  school: { schoolId?: string },
  apply: boolean, report: CleanupReport, count: (k: string) => void) {
  const users = await prisma.user.findMany({
    where: { ...school, phone: { not: null } },
    select: { id: true, schoolId: true, phone: true },
  });
  const taken = new Set(users.map((u) => `${u.schoolId}|${u.phone}`));
  for (const u of users) {
    const phone = normalizePhone(u.phone!);
    if (!phone) {
      report.problems.push({ table: 'User', id: u.id, schoolId: u.schoolId, field: 'phone', value: u.phone!, reason: NOT_MOBILE });
      continue;
    }
    if (phone === u.phone) continue;
    if (taken.has(`${u.schoolId}|${phone}`)) {
      report.problems.push({
        table: 'User',
        id: u.id,
        schoolId: u.schoolId,
        field: 'phone',
        value: u.phone!,
        reason: `Another login at this school already uses ${phone}`,
      });
      continue;
    }
    taken.add(`${u.schoolId}|${phone}`);
    count('User.phone');
    if (apply) await prisma.user.update({ where: { id: u.id }, data: { phone } });
  }
}
