import { findClashes, sortPapers, type SheetPaper } from './datesheet.js';

const paper = (over: Partial<SheetPaper>): SheetPaper => ({
  id: 'p',
  classId: 'c1',
  className: 'Grade 5',
  subject: 'English',
  date: '2026-12-01',
  startTime: '09:00',
  endTime: '11:00',
  room: null,
  syllabus: null,
  ...over,
});

describe('sortPapers', () => {
  it('orders by date, then time, then subject, with undated papers last', () => {
    const sorted = sortPapers([
      paper({ id: 'undated', date: null }),
      paper({ id: 'late', date: '2026-12-02' }),
      paper({ id: 'urdu', subject: 'Urdu', startTime: '09:00' }),
      paper({ id: 'maths', subject: 'Maths', startTime: '09:00' }),
      paper({ id: 'early', startTime: '08:00', subject: 'Zoology' }),
    ]);
    expect(sorted.map((p) => p.id)).toEqual([
      'early',
      'maths',
      'urdu',
      'late',
      'undated',
    ]);
  });
});

describe('findClashes', () => {
  it('flags a class sitting two overlapping papers', () => {
    const out = findClashes([
      paper({ id: 'a' }),
      paper({
        id: 'b',
        subject: 'Maths',
        startTime: '10:00',
        endTime: '12:00',
      }),
    ]);
    expect(out).toEqual([
      'Grade 5 has English and Maths at the same time on 2026-12-01',
    ]);
  });

  it('allows back-to-back papers and different days', () => {
    expect(
      findClashes([
        paper({ id: 'a' }),
        paper({
          id: 'b',
          subject: 'Maths',
          startTime: '11:00',
          endTime: '13:00',
        }),
        paper({ id: 'c', subject: 'Urdu', date: '2026-12-02' }),
      ]),
    ).toEqual([]);
  });

  it('treats a paper without times as taking the whole day', () => {
    const out = findClashes([
      paper({ id: 'a', startTime: null, endTime: null }),
      paper({ id: 'b', subject: 'Maths' }),
    ]);
    expect(out).toHaveLength(1);
  });

  it('flags one room used by two classes at once, but not different rooms or undated papers', () => {
    const other = { classId: 'c2', className: 'Grade 6', subject: 'Maths' };
    expect(
      findClashes([
        paper({ id: 'a', room: 'Hall' }),
        paper({ id: 'b', ...other, room: 'Hall' }),
      ]),
    ).toHaveLength(1);
    expect(
      findClashes([
        paper({ id: 'a', room: 'Hall' }),
        paper({ id: 'b', ...other, room: 'Lab' }),
      ]),
    ).toEqual([]);
    expect(
      findClashes([
        paper({ id: 'a', date: null, room: 'Hall' }),
        paper({ id: 'b', ...other, date: null, room: 'Hall' }),
      ]),
    ).toEqual([]);
  });
});
