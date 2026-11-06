import { describe, expect, it } from 'vitest';
import { dropoutRow, genderSplit, passFail } from './insights.js';

describe('genderSplit', () => {
  it('counts overall and per class in natural class order', () => {
    const g = genderSplit([
      { gender: 'MALE', className: 'Grade 10' },
      { gender: 'FEMALE', className: 'Grade 2' },
      { gender: 'FEMALE', className: 'Grade 2' },
      { gender: 'OTHER', className: 'Grade 2' },
    ]);
    expect(g.overall).toEqual({ MALE: 1, FEMALE: 2, OTHER: 1 });
    expect(g.byClass.map((c) => c.name)).toEqual(['Grade 2', 'Grade 10']);
    expect(g.byClass[0]).toMatchObject({ male: 0, female: 2, other: 1 });
  });
});

describe('dropoutRow', () => {
  it('counts left and transferred students against everyone enrolled', () => {
    expect(dropoutRow('2025-26', { ACTIVE: 80, PROMOTED: 10, LEFT: 6, TRANSFERRED: 4 })).toEqual({
      year: '2025-26',
      enrolled: 100,
      left: 6,
      transferred: 4,
      dropoutPct: 10,
    });
    expect(dropoutRow('empty', {}).dropoutPct).toBe(0);
  });
});

describe('passFail', () => {
  it('groups by label with a pass rate', () => {
    const rows = passFail([
      { label: 'Mid-term', passed: true },
      { label: 'Mid-term', passed: true },
      { label: 'Mid-term', passed: false },
      { label: 'Final', passed: false },
    ]);
    expect(rows).toEqual([
      { name: 'Mid-term', passed: 2, failed: 1, passPct: 66.7 },
      { name: 'Final', passed: 0, failed: 1, passPct: 0 },
    ]);
  });
});
