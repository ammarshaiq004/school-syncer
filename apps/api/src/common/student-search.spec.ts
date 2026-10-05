import { searchTokens, studentSearchWhere } from './student-search.js';

describe('searchTokens', () => {
  it('splits on any run of whitespace and drops the padding', () => {
    expect(searchTokens('  Musa   Sheikh ')).toEqual(['Musa', 'Sheikh']);
  });

  it('is empty for nothing typed', () => {
    expect(searchTokens(undefined)).toEqual([]);
    expect(searchTokens('   ')).toEqual([]);
  });

  it('keeps at most five words', () => {
    expect(searchTokens('a b c d e f g')).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('studentSearchWhere', () => {
  it('is null when there is nothing to match on', () => {
    expect(studentSearchWhere('')).toBeNull();
    expect(studentSearchWhere(undefined)).toBeNull();
  });

  it('ANDs the words so a full name matches first and last name together', () => {
    const where = studentSearchWhere('Musa Sheikh');
    expect(where?.AND).toHaveLength(2);
    const [first, second] = where!.AND as { OR: unknown[] }[];
    expect(first.OR).toContainEqual({ firstName: { contains: 'Musa', mode: 'insensitive' } });
    expect(second.OR).toContainEqual({ lastName: { contains: 'Sheikh', mode: 'insensitive' } });
  });

  it('matches one word against name or admission number', () => {
    const where = studentSearchWhere('2024');
    expect(where?.AND).toHaveLength(1);
    expect((where!.AND as { OR: unknown[] }[])[0].OR).toEqual([
      { firstName: { contains: '2024', mode: 'insensitive' } },
      { lastName: { contains: '2024', mode: 'insensitive' } },
      { admissionNo: { contains: '2024', mode: 'insensitive' } },
    ]);
  });

  it('adds guardian phone only where it was asked for', () => {
    const plain = (studentSearchWhere('0300')!.AND as { OR: unknown[] }[])[0].OR;
    const withPhone = (studentSearchWhere('0300', { guardianPhone: true })!.AND as { OR: unknown[] }[])[0].OR;
    expect(plain).toHaveLength(3);
    expect(withPhone).toContainEqual({ guardians: { some: { guardian: { phone: { contains: '0300' } } } } });
  });
});
