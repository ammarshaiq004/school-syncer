import {
  failures,
  multiExam,
  subjectStats,
  teacherStats,
  toppers,
  type ReportRow,
} from './exam-reports.js';

const sub = (
  subject: string,
  marks: number | null,
  pass = 33,
  absent = false,
) => ({
  subject,
  max: 100,
  pass,
  marks,
  absent,
  passed: !absent && marks !== null && marks >= pass,
});

const row = (
  studentId: string,
  sectionId: string,
  position: number,
  subjects: ReturnType<typeof sub>[],
): ReportRow => {
  const obtained = subjects.reduce((n, s) => n + (s.marks ?? 0), 0);
  return {
    studentId,
    name: studentId.toUpperCase(),
    admissionNo: studentId,
    sectionId,
    section: sectionId === 's1' ? 'Grade 5 A' : 'Grade 5 B',
    obtained,
    maxTotal: subjects.length * 100,
    percent: obtained / subjects.length,
    grade: 'B',
    position,
    passed: subjects.every((s) => s.passed),
    subjects,
  };
};

const rows = [
  row('a', 's1', 1, [sub('English', 90), sub('Maths', 80)]),
  row('b', 's1', 2, [sub('English', 70), sub('Maths', 20)]),
  row('c', 's1', 2, [sub('English', 60), sub('Maths', 30)]),
  row('d', 's1', 4, [sub('English', 10), sub('Maths', null, 33, true)]),
  row('e', 's2', 1, [sub('English', 50), sub('Maths', 60)]),
];

describe('toppers', () => {
  it('lists the top positions per section, keeping ties', () => {
    const out = toppers(rows, 2);
    expect(out.map((s) => s.section)).toEqual(['Grade 5 A', 'Grade 5 B']);
    expect(out[0].students.map((s) => s.studentId)).toEqual(['a', 'b', 'c']);
    expect(out[1].students.map((s) => s.studentId)).toEqual(['e']);
  });
});

describe('failures', () => {
  it('lists who failed which papers, with pass rates', () => {
    const out = failures(rows);
    expect(out.students).toBe(5);
    expect(out.failed).toBe(3);
    expect(out.passRate).toBe(40);
    expect(out.list.map((s) => [s.studentId, s.failedSubjects])).toEqual([
      ['d', ['English', 'Maths']],
      ['b', ['Maths']],
      ['c', ['Maths']],
    ]);
    expect(out.sections).toEqual([
      {
        sectionId: 's1',
        section: 'Grade 5 A',
        students: 4,
        failed: 3,
        passRate: 25,
      },
      {
        sectionId: 's2',
        section: 'Grade 5 B',
        students: 1,
        failed: 0,
        passRate: 100,
      },
    ]);
  });

  it('copes with no results', () => {
    expect(failures([])).toMatchObject({
      students: 0,
      failed: 0,
      passRate: 0,
      list: [],
    });
  });
});

describe('subjectStats', () => {
  it('averages every subject per section, counting absent as zero but not as lowest', () => {
    const maths = subjectStats(rows).find(
      (s) => s.sectionId === 's1' && s.subject === 'Maths',
    )!;
    expect(maths).toMatchObject({
      students: 4,
      average: 32.5,
      passRate: 25,
      highest: 80,
      lowest: 20,
      absent: 1,
    });
  });

  it('reports zero spread when everyone was absent', () => {
    const s = subjectStats([
      row('x', 's1', 1, [sub('Art', null, 33, true)]),
    ])[0];
    expect(s).toMatchObject({ average: 0, highest: 0, lowest: 0, absent: 1 });
  });
});

describe('teacherStats', () => {
  it('weights by students, ranks best first and skips unassigned subjects', () => {
    const teachers = new Map([
      ['s1|English', { id: 't1', name: 'Sara' }],
      ['s2|English', { id: 't1', name: 'Sara' }],
      ['s1|Maths', { id: 't2', name: 'Omar' }],
    ]);
    const out = teacherStats(subjectStats(rows), teachers);
    expect(out.map((t) => t.teacher)).toEqual(['Sara', 'Omar']);
    // English: s1 average 57.5 over 4 students, s2 50 over 1 -> (230 + 50) / 5
    expect(out[0]).toMatchObject({ classes: 2, students: 5, average: 56 });
    expect(out[1]).toMatchObject({
      classes: 1,
      students: 4,
      average: 32.5,
      passRate: 25,
    });
  });
});

describe('multiExam', () => {
  const first = [
    row('a', 's1', 1, [sub('English', 60)]),
    row('b', 's1', 2, [sub('English', 80)]),
  ];
  const second = [
    row('a', 's1', 1, [sub('English', 90)]),
    row('c', 's1', 2, [sub('English', 40)]),
  ];

  it('combines marks, ranks and shows the change between first and last exam', () => {
    const out = multiExam([first, second]);
    expect(
      out.map((s) => [s.studentId, s.average, s.position, s.change]),
    ).toEqual([
      ['b', 80, 1, 0],
      ['a', 75, 2, 30],
      ['c', 40, 3, 0],
    ]);
  });

  it('leaves a gap for an exam the student missed', () => {
    const b = multiExam([first, second]).find((s) => s.studentId === 'b')!;
    expect(b.percents).toEqual([80, null]);
  });

  it('shares a position between equal averages', () => {
    const out = multiExam([
      [
        row('a', 's1', 1, [sub('English', 70)]),
        row('b', 's1', 1, [sub('English', 70)]),
      ],
      [],
    ]);
    expect(out.map((s) => s.position)).toEqual([1, 1]);
  });
});
