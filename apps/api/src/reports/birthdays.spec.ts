import { describe, expect, it } from 'vitest';
import { birthdaysInMonth, type BirthdayPerson } from './birthdays.js';

const p = (name: string, dateOfBirth: string, kind: BirthdayPerson['kind'] = 'student'): BirthdayPerson => ({ kind, name, ref: '1', detail: '', dateOfBirth });

describe('birthdaysInMonth', () => {
  it('keeps one month, sorted by day then name, with the age they turn', () => {
    const rows = birthdaysInMonth([p('Zara', '2015-11-20'), p('Ali', '2014-11-03'), p('Bela', '2015-11-03'), p('Out', '2015-10-03'), p('Teacher', '1990-11-20', 'staff')], 11, 2026);
    expect(rows.map((r) => [r.name, r.day, r.turns])).toEqual([['Ali', 3, 12], ['Bela', 3, 11], ['Teacher', 20, 36], ['Zara', 20, 11]]);
  });

  it('is empty when nobody was born in the month', () => {
    expect(birthdaysInMonth([p('Ali', '2014-11-03')], 5, 2026)).toEqual([]);
  });
});
