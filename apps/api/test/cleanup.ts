import type { PrismaService } from '../src/prisma/prisma.service.js';

/**
 * Deletes test schools. Payments, payroll, account entries, exams, students
 * and applications are removed first because the schema deliberately refuses
 * to cascade-delete money and enrollment history.
 */
export async function deleteSchools(prisma: PrismaService, where: { slug?: string; email?: { endsWith: string } }) {
  const schools = await prisma.school.findMany({ where, select: { id: true } });
  const schoolId = { in: schools.map((s) => s.id) };
  await prisma.payment.deleteMany({ where: { schoolId } });
  await prisma.exam.deleteMany({ where: { schoolId } });
  await prisma.payrollRun.deleteMany({ where: { schoolId } });
  await prisma.accountEntry.deleteMany({ where: { schoolId } });
  await prisma.application.deleteMany({ where: { schoolId } });
  await prisma.student.deleteMany({ where: { schoolId } });
  await prisma.school.deleteMany({ where: { id: schoolId } });
}
