import { describe, expect, it } from 'vitest';
import { cleanPickList } from './pick-list.js';

describe('cleanPickList', () => {
  it('trims, drops blanks and repeats, and sorts', () => {
    expect(cleanPickList([' Teacher ', '', 'farmer', 'Teacher', 'TEACHER', 'Shop   keeper'])).toEqual(['farmer', 'Shop keeper', 'Teacher']);
  });
});
