import type { PrismaService } from '../prisma/prisma.service.js';

/** Guardians to message for each student: the primary one, or all if none is marked. */
export async function guardianPhones(
  prisma: PrismaService,
  studentIds: string[],
): Promise<Map<string, string[]>> {
  const links = await prisma.studentGuardian.findMany({
    where: { studentId: { in: studentIds } },
    include: { guardian: { select: { phone: true } } },
  });
  const result = new Map<string, string[]>();
  for (const id of studentIds) {
    const own = links.filter((l) => l.studentId === id);
    const primary = own.filter((l) => l.isPrimary);
    result.set(id, (primary.length ? primary : own).map((l) => l.guardian.phone));
  }
  return result;
}
