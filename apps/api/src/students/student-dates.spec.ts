import { StudentStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { studentDates } from './student-dates.js';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const today = '2026-11-12';
const active = { status: StudentStatus.ACTIVE, admittedOn: d('2024-04-01'), leftOn: null };
const left = { status: StudentStatus.LEFT, admittedOn: d('2024-04-01'), leftOn: d('2026-08-10') };

describe('studentDates', () => {
  it('saves a back-dated admission and refuses a future one', () => {
    expect(studentDates({ admittedOn: d('2023-04-01'), today })).toEqual({ admittedOn: d('2023-04-01') });
    expect(() => studentDates({ admittedOn: d('2026-11-13'), today })).toThrow('future');
  });

  it('defaults the leaving date to today only when none is given', () => {
    expect(studentDates({ before: active, status: StudentStatus.LEFT, today })).toEqual({ leftOn: d(today) });
    expect(studentDates({ before: active, status: StudentStatus.LEFT, leftOn: d('2026-10-31'), today })).toEqual({
      leftOn: d('2026-10-31'),
    });
  });

  it('keeps the date on file when a left student is saved again, and clears it on return', () => {
    expect(studentDates({ before: left, status: StudentStatus.LEFT, today })).toEqual({ leftOn: d('2026-08-10') });
    expect(studentDates({ before: left, status: StudentStatus.ACTIVE, today })).toEqual({ leftOn: null });
  });

  it('rejects a leaving date that is in the future, before admission, or on a student who has not left', () => {
    expect(() => studentDates({ before: active, status: StudentStatus.LEFT, leftOn: d('2026-12-01'), today })).toThrow('future');
    expect(() => studentDates({ before: active, status: StudentStatus.LEFT, leftOn: d('2024-03-01'), today })).toThrow('before the admission');
    expect(() => studentDates({ before: active, leftOn: d('2026-10-01'), today })).toThrow('marked Left');
  });

  it('does not let a new admission date land after the leaving date on file', () => {
    expect(() => studentDates({ before: left, admittedOn: d('2026-09-01'), today })).toThrow('before the admission');
  });
});
