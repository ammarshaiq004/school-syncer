import { candidateSearchWhere } from './candidate-search.js';

describe('candidateSearchWhere', () => {
  it('matches nothing extra for an empty search', () => {
    expect(candidateSearchWhere('  ')).toEqual({ AND: [] });
    expect(candidateSearchWhere(undefined)).toEqual({ AND: [] });
  });

  it('requires every word somewhere, case-insensitively', () => {
    const where = candidateSearchWhere('maths Ayesha');
    expect(where.AND).toHaveLength(2);
    expect(JSON.stringify(where)).toContain('"contains":"Ayesha","mode":"insensitive"');
  });

  it('looks at no more than five words', () => {
    expect(candidateSearchWhere('a b c d e f g').AND).toHaveLength(5);
  });
});
