import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';

export interface FamilyMember {
  id: string;
  guardianIds: string[];
  admittedOn: Date;
  admissionNo: string;
}

export interface SiblingPlace {
  /** 1 for the first-admitted child of the family, 2 for the next, and so on. */
  rank: number;
  /** Children in the family being billed, this one included. */
  size: number;
  /** Every child in the family, in rank order. */
  family: string[];
}

/**
 * Groups students into families (two students sharing any guardian are
 * siblings, and so is anyone linked through a chain of shared guardians) and
 * ranks each family by admission: earliest admitted first, then admission
 * number. The first child pays in full; the sibling discount starts at the
 * second.
 */
export function siblingRanks(members: FamilyMember[]): Map<string, SiblingPlace> {
  const parent = new Map<string, string>(members.map((m) => [m.id, m.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    // Path compression keeps large schools quick.
    for (let n = id; n !== root; ) {
      const next = parent.get(n)!;
      parent.set(n, root);
      n = next;
    }
    return root;
  };
  const byGuardian = new Map<string, string>();
  for (const m of members) {
    for (const g of m.guardianIds) {
      const other = byGuardian.get(g);
      if (other) parent.set(find(m.id), find(other));
      else byGuardian.set(g, m.id);
    }
  }
  const families = new Map<string, FamilyMember[]>();
  for (const m of members) {
    const root = find(m.id);
    families.set(root, [...(families.get(root) ?? []), m]);
  }
  const places = new Map<string, SiblingPlace>();
  for (const kids of families.values()) {
    kids.sort(
      (a, b) =>
        a.admittedOn.getTime() - b.admittedOn.getTime() ||
        a.admissionNo.localeCompare(b.admissionNo, 'en', { numeric: true }) ||
        a.id.localeCompare(b.id),
    );
    const family = kids.map((k) => k.id);
    kids.forEach((k, i) => places.set(k.id, { rank: i + 1, size: kids.length, family }));
  }
  return places;
}

/**
 * Families among the school's active students enrolled in an academic year,
 * across every campus (a family's size does not depend on who is billing).
 */
export async function schoolSiblings(
  prisma: PrismaService | Prisma.TransactionClient,
  schoolId: string,
  academicYearId: string,
): Promise<Map<string, SiblingPlace>> {
  const students = await prisma.student.findMany({
    where: {
      schoolId,
      status: 'ACTIVE',
      enrollments: { some: { academicYearId, status: 'ACTIVE' } },
    },
    select: { id: true, admittedOn: true, admissionNo: true, guardians: { select: { guardianId: true } } },
  });
  return siblingRanks(
    students.map((s) => ({
      id: s.id,
      admittedOn: s.admittedOn,
      admissionNo: s.admissionNo,
      guardianIds: s.guardians.map((g) => g.guardianId),
    })),
  );
}
