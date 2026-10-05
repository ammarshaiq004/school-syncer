import { Prisma } from '@prisma/client';

/** At most this many words are matched; the rest of a long paste is ignored. */
const MAX_TOKENS = 5;

/** The words of a search box, e.g. `" Musa  Sheikh "` to `['Musa', 'Sheikh']`. */
export function searchTokens(search: string | undefined | null): string[] {
  return (search ?? '').trim().split(/\s+/).filter(Boolean).slice(0, MAX_TOKENS);
}

export interface StudentSearchOptions {
  /** Also match a guardian's phone number (the admin student list). */
  guardianPhone?: boolean;
}

/**
 * Matches a student by free text. Every word must hit the first name, last name
 * or admission number, so "Musa Sheikh" finds Musa Sheikh (in either order)
 * while a single word still works as before. Null when there is nothing to
 * match on, so callers can leave the filter out.
 */
export function studentSearchWhere(
  search: string | undefined | null,
  options: StudentSearchOptions = {},
): Prisma.StudentWhereInput | null {
  const tokens = searchTokens(search);
  if (!tokens.length) return null;
  return {
    AND: tokens.map((token): Prisma.StudentWhereInput => {
      const OR: Prisma.StudentWhereInput[] = [
        { firstName: { contains: token, mode: 'insensitive' } },
        { lastName: { contains: token, mode: 'insensitive' } },
        { admissionNo: { contains: token, mode: 'insensitive' } },
      ];
      if (options.guardianPhone) {
        OR.push({ guardians: { some: { guardian: { phone: { contains: token } } } } });
      }
      return { OR };
    }),
  };
}
