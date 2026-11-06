import type { Prisma } from '@prisma/client';

/** Every word typed must appear in the name, position, qualification, source, phone or email. */
export function candidateSearchWhere(search: string | undefined): Prisma.CandidateWhereInput {
  const words = (search ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 5);
  return {
    AND: words.map((w) => ({
      OR: (['name', 'position', 'qualification', 'source', 'phone', 'email', 'notes'] as const).map((field) => ({
        [field]: { contains: w, mode: 'insensitive' as const },
      })),
    })),
  };
}
