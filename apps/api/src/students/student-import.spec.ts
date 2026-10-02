import { Gender } from '@prisma/client';
import {
  checkImportRows,
  importRowSchema,
  normalizePhone,
  parseDate,
  parseGender,
} from './student-import.js';

const sections = [
  { id: 's1a', campusName: 'Main', className: 'Grade 1', sectionName: 'A' },
  { id: 's1b', campusName: 'Main', className: 'Grade 1', sectionName: 'B' },
];
const row = (over: Record<string, string> = {}) =>
  importRowSchema.parse({
    firstName: 'Ayesha',
    lastName: 'Khan',
    gender: 'F',
    class: 'Grade 1',
    section: 'A',
    guardianName: 'Imran Khan',
    guardianPhone: '0300-1234567',
    ...over,
  });

describe('cell parsers', () => {
  it('reads genders as schools write them', () => {
    expect(parseGender('Male')).toBe(Gender.MALE);
    expect(parseGender('girl')).toBe(Gender.FEMALE);
    expect(parseGender('x')).toBeUndefined();
  });

  it('normalizes Pakistani mobile numbers', () => {
    expect(normalizePhone('0300 1234567')).toBe('03001234567');
    expect(normalizePhone('+92 300 1234567')).toBe('03001234567');
    expect(normalizePhone('923001234567')).toBe('03001234567');
    expect(normalizePhone('3001234567')).toBe('03001234567');
    expect(normalizePhone('042-35761234')).toBeUndefined();
  });

  it('reads day-first and ISO dates and rejects impossible ones', () => {
    expect(parseDate('21/03/2015')?.toISOString()).toBe(
      '2015-03-21T00:00:00.000Z',
    );
    expect(parseDate('2015-03-21')?.toISOString()).toBe(
      '2015-03-21T00:00:00.000Z',
    );
    expect(parseDate('31/02/2015')).toBeUndefined();
    expect(parseDate('March 2015')).toBeUndefined();
  });
});

describe('checkImportRows', () => {
  it('turns a good row into a student', () => {
    const [r] = checkImportRows(
      [row({ dateOfBirth: '21.03.2019', rollNo: '4' })],
      sections,
      new Set(),
    );
    expect(r).toMatchObject({
      row: 2,
      name: 'Ayesha Khan',
      classSection: 'Grade 1 A',
      errors: [],
    });
    expect(r.student).toMatchObject({
      sectionId: 's1a',
      rollNo: 4,
      gender: Gender.FEMALE,
      guardians: [
        {
          name: 'Imran Khan',
          phone: '03001234567',
          relation: 'Guardian',
          isPrimary: true,
        },
      ],
    });
  });

  it('accepts class and section in one cell', () => {
    const [r] = checkImportRows(
      [row({ class: 'grade 1-b', section: '' })],
      sections,
      new Set(),
    );
    expect(r.student?.sectionId).toBe('s1b');
  });

  it('lists every problem on a row', () => {
    const [r] = checkImportRows(
      [
        row({
          firstName: '',
          gender: 'X',
          class: 'Grade 9',
          guardianPhone: '12345',
          dateOfBirth: '2015/40/1',
        }),
      ],
      sections,
      new Set(),
    );
    expect(r.student).toBeUndefined();
    expect(r.errors).toEqual([
      'First name is missing',
      'Gender "X" should be Male or Female',
      'Date of birth "2015/40/1" should look like 21/03/2015',
      'No section "Grade 9 A" this year',
      'Guardian phone "12345" should be a mobile number like 0300 1234567',
    ]);
  });

  it('catches duplicate admission and roll numbers', () => {
    const rows = checkImportRows(
      [
        row({ admissionNo: 'A-1', rollNo: '1' }),
        row({ admissionNo: 'A-1', rollNo: '1' }),
        row({ admissionNo: 'OLD-7' }),
        row({ rollNo: '1', section: 'B' }),
        row({ rollNo: '3', section: 'B' }),
      ],
      sections,
      new Set(['OLD-7']),
      new Set(['s1b|3']),
    );
    expect(rows.map((r) => r.errors)).toEqual([
      [],
      [
        'Admission number A-1 is also on row 2',
        'Roll number 1 is also on row 2',
      ],
      ['Admission number OLD-7 already belongs to a student'],
      [],
      ['Roll number 3 is already taken in Grade 1 B'],
    ]);
  });

  it('adds a second guardian and needs at least one', () => {
    const [two, none] = checkImportRows(
      [
        row({
          guardianRelation: 'Father',
          guardian2Name: 'Sana Khan',
          guardian2Relation: 'Mother',
          guardian2Phone: '03211234567',
        }),
        row({ guardianName: '', guardianPhone: '' }),
      ],
      sections,
      new Set(),
    );
    expect(
      two.student?.guardians.map((g) => [g.relation, g.isPrimary]),
    ).toEqual([
      ['Father', true],
      ['Mother', false],
    ]);
    expect(none.errors).toEqual(['Guardian name and phone are missing']);
  });

  it('needs the campus when two campuses share a class name', () => {
    const both = [
      ...sections,
      {
        id: 'j1a',
        campusName: 'Johar Town',
        className: 'Grade 1',
        sectionName: 'A',
      },
    ];
    const [unclear, chosen, wrong] = checkImportRows(
      [row(), row({ campus: 'johar town' }), row({ campus: 'Gulberg' })],
      both,
      new Set(),
    );
    expect(unclear.errors).toEqual([
      '"Grade 1 A" is at more than one campus (Main, Johar Town); fill in the Campus column',
    ]);
    expect(chosen.student?.sectionId).toBe('j1a');
    expect(wrong.errors).toEqual(['No section "Grade 1 A" at Gulberg']);

    const [elsewhere] = checkImportRows(
      [row({ campus: 'Johar Town' })],
      sections,
      new Set(),
      new Set(),
      ['Johar Town'],
    );
    expect(elsewhere.errors).toEqual([
      "Your login can't add students at Johar Town",
    ]);
  });
});
