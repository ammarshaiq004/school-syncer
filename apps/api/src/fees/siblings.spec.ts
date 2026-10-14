import { siblingRanks, type FamilyMember } from './siblings.js';

const kid = (id: string, guardianIds: string[], admittedOn: string, admissionNo = id): FamilyMember => ({
  id,
  guardianIds,
  admittedOn: new Date(admittedOn),
  admissionNo,
});

describe('siblingRanks', () => {
  it('ranks children who share a guardian by admission, earliest first', () => {
    const ranks = siblingRanks([
      kid('c', ['father'], '2024-04-01'),
      kid('a', ['father', 'mother'], '2020-04-01'),
      kid('b', ['mother'], '2022-04-01'),
      kid('x', ['other'], '2021-04-01'),
    ]);
    expect(ranks.get('a')).toEqual({ rank: 1, size: 3, family: ['a', 'b', 'c'] });
    expect(ranks.get('b')?.rank).toBe(2);
    expect(ranks.get('c')?.rank).toBe(3);
    expect(ranks.get('x')).toEqual({ rank: 1, size: 1, family: ['x'] });
  });

  it('links families through a chain of shared guardians', () => {
    // a and b share a father; b and c share a mother: one family.
    const ranks = siblingRanks([kid('a', ['f'], '2020-01-01'), kid('b', ['f', 'm'], '2021-01-01'), kid('c', ['m'], '2022-01-01')]);
    expect(ranks.get('c')).toMatchObject({ rank: 3, size: 3 });
  });

  it('breaks a same-day admission by admission number', () => {
    const ranks = siblingRanks([kid('p', ['g'], '2025-04-01', 'ADM-10'), kid('q', ['g'], '2025-04-01', 'ADM-9')]);
    expect(ranks.get('q')?.rank).toBe(1);
    expect(ranks.get('p')?.rank).toBe(2);
  });

  it('treats a child with no guardian as an only child', () => {
    expect(siblingRanks([kid('solo', [], '2025-01-01')]).get('solo')).toMatchObject({ rank: 1, size: 1 });
  });
});
