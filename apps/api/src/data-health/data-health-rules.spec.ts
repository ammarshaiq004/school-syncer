import { healthScore, runHealthChecks, SAMPLE_SIZE, type HealthSnapshot } from './data-health-rules.js';

const student = (over: Partial<HealthSnapshot['students'][number]> = {}) => ({
  id: 's1',
  name: 'Ali Khan',
  admissionNo: '001',
  dateOfBirth: new Date('2015-04-01'),
  bFormNo: '35202-1234567-1',
  enrolled: true,
  guardianPhones: ['0300 1234567'],
  ...over,
});

const clean = (over: Partial<HealthSnapshot> = {}): HealthSnapshot => ({
  students: [student()],
  enrollments: [{ studentId: 's1', sectionId: 'a', rollNo: 1 }],
  sections: [{ id: 'a', name: 'Grade 1 A', capacity: 30, enrolled: 1, hasClassTeacher: true, subjectsWithoutTeacher: [], lessons: 30 }],
  classesWithoutFees: [],
  usesTimetable: true,
  staff: [{ id: 't', name: 'Sara', phone: '03001234567' }],
  overpaid: [],
  ...over,
});

const failing = (snap: HealthSnapshot) => runHealthChecks(snap).filter((c) => c.count).map((c) => c.key);

describe('data health checks', () => {
  it('passes clean data with a perfect score', () => {
    const checks = runHealthChecks(clean());
    expect(checks.every((c) => c.count === 0)).toBe(true);
    expect(healthScore(checks, 1)).toBe(100);
  });

  it('flags students with no class, no guardian, bad phone, no birth date and a bad B-Form', () => {
    const keys = failing(
      clean({
        students: [
          student({ id: 'a', enrolled: false }),
          student({ id: 'b', guardianPhones: [], name: 'B', dateOfBirth: null }),
          student({ id: 'c', guardianPhones: ['12345'], name: 'C', bFormNo: '123' }),
        ],
      }),
    );
    expect(keys).toEqual(
      expect.arrayContaining(['students-not-enrolled', 'students-no-guardian', 'guardian-phone-invalid', 'student-dob-missing', 'student-bform-invalid']),
    );
  });

  it('accepts a second good number when the first is bad', () => {
    expect(failing(clean({ students: [student({ guardianPhones: ['abc', '+92 300 1234567'] })] }))).not.toContain('guardian-phone-invalid');
  });

  it('finds duplicate students and ignores ones without a birth date', () => {
    const twin = [student({ id: 'a' }), student({ id: 'b', name: ' ali  KHAN ' })];
    expect(runHealthChecks(clean({ students: twin })).find((c) => c.key === 'student-duplicates')?.count).toBe(2);
    const unknown = [student({ id: 'a', dateOfBirth: null }), student({ id: 'b', dateOfBirth: null })];
    expect(runHealthChecks(clean({ students: unknown })).find((c) => c.key === 'student-duplicates')?.count).toBe(0);
  });

  it('flags repeated roll numbers within a section only', () => {
    const students = [student({ id: 'a' }), student({ id: 'b', name: 'Bilal', dateOfBirth: null })];
    const same = [{ studentId: 'a', sectionId: 'x', rollNo: 1 }, { studentId: 'b', sectionId: 'x', rollNo: 1 }];
    const other = [{ studentId: 'a', sectionId: 'x', rollNo: 1 }, { studentId: 'b', sectionId: 'y', rollNo: 1 }];
    expect(runHealthChecks(clean({ students, enrollments: same })).find((c) => c.key === 'roll-clashes')?.count).toBe(2);
    expect(runHealthChecks(clean({ students, enrollments: other })).find((c) => c.key === 'roll-clashes')?.count).toBe(0);
  });

  it('flags section problems', () => {
    const keys = failing(
      clean({
        sections: [{ id: 'a', name: 'Grade 1 A', capacity: 1, enrolled: 2, hasClassTeacher: false, subjectsWithoutTeacher: ['Maths'], lessons: 0 }],
      }),
    );
    expect(keys).toEqual(expect.arrayContaining(['sections-no-class-teacher', 'sections-subject-no-teacher', 'sections-over-capacity', 'sections-no-timetable']));
  });

  it('skips fee and timetable checks when the school does not use them', () => {
    const keys = runHealthChecks(clean({ classesWithoutFees: null, usesTimetable: false })).map((c) => c.key);
    expect(keys).not.toContain('classes-no-fee-structure');
    expect(keys).not.toContain('sections-no-timetable');
  });

  it('flags classes without fees, staff without a phone and overpaid vouchers', () => {
    const keys = failing(
      clean({
        classesWithoutFees: ['Grade 2'],
        staff: [{ id: 't', name: 'Sara', phone: null }],
        overpaid: [{ id: 'i', voucherNo: 'V-1', total: 100, paid: 150 }],
      }),
    );
    expect(keys).toEqual(expect.arrayContaining(['classes-no-fee-structure', 'staff-no-phone', 'invoices-overpaid']));
  });

  it('shows only a sample but counts everything', () => {
    const many = Array.from({ length: 25 }, (_, i) => student({ id: `s${i}`, name: `S${i}`, enrolled: false }));
    const c = runHealthChecks(clean({ students: many })).find((x) => x.key === 'students-not-enrolled');
    expect(c?.count).toBe(25);
    expect(c?.items).toHaveLength(SAMPLE_SIZE);
  });

  it('scores errors lower than warnings and never below zero', () => {
    const warn = runHealthChecks(clean({ staff: [{ id: 't', name: 'Sara', phone: null }] }));
    const err = runHealthChecks(clean({ overpaid: [{ id: 'i', voucherNo: 'V-1', total: 1, paid: 2 }] }));
    expect(healthScore(err, 100)).toBeLessThan(healthScore(warn, 100));
    expect(healthScore(Array(30).fill({ ...err[0], count: 5, severity: 'error' }), 1)).toBe(0);
  });
});

describe('migration data checks', () => {
  it('flags placeholder birth dates, missing gender, bad guardian CNICs and staff sharing a phone', () => {
    const keys = failing(
      clean({
        students: [
          student({ id: 'a', dateOfBirth: new Date('1970-01-01') }),
          student({ id: 'b', name: 'B', dateOfBirth: new Date('0001-01-01T00:00:00Z') }),
          student({ id: 'c', name: 'C', gender: 'UNSPECIFIED', guardianCnics: ['123'] }),
        ],
        staff: [
          { id: 't1', name: 'Sara', phone: '0300 1234567' },
          { id: 't2', name: 'Ayesha', phone: '+92 300 1234567' },
        ],
      }),
    );
    expect(keys).toEqual(expect.arrayContaining(['student-dob-placeholder', 'student-gender-missing', 'guardian-cnic-invalid', 'staff-shared-phone']));
    const dob = runHealthChecks(clean({ students: [student({ dateOfBirth: new Date('1970-01-01') }), student({ id: 'x', name: 'X' })] })).find((c) => c.key === 'student-dob-placeholder');
    expect(dob?.count).toBe(1);
  });

  it('leaves real dates, recorded genders and valid CNICs alone', () => {
    const keys = failing(clean({ students: [student({ gender: 'MALE', guardianCnics: ['35202-1234567-1', null] })] }));
    expect(keys).not.toContain('student-dob-placeholder');
    expect(keys).not.toContain('student-gender-missing');
    expect(keys).not.toContain('guardian-cnic-invalid');
  });
});
