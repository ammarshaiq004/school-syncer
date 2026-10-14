import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * Turns the userId and studentId on history rows read from the audit log into
 * names for showing to people: `by` (who made the change) and `studentName`.
 */
export async function withNames<T extends { userId: string | null; studentId: string }>(
  prisma: PrismaService,
  schoolId: string,
  rows: T[],
) {
  const userIds = [...new Set(rows.map((r) => r.userId).filter((id): id is string => Boolean(id)))];
  const studentIds = [...new Set(rows.map((r) => r.studentId))];
  const [users, students] = await Promise.all([
    userIds.length
      ? prisma.user.findMany({ where: { schoolId, id: { in: userIds } }, select: { id: true, name: true } })
      : [],
    studentIds.length
      ? prisma.student.findMany({
          where: { schoolId, id: { in: studentIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [],
  ]);
  const by = new Map(users.map((u) => [u.id, u.name]));
  const student = new Map(students.map((s) => [s.id, [s.firstName, s.lastName].filter(Boolean).join(' ')]));
  return rows.map(({ userId, ...row }) => ({
    ...row,
    by: (userId && by.get(userId)) || 'Unknown',
    studentName: student.get(row.studentId) ?? '',
  }));
}
