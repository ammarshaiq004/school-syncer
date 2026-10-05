// E-school demo data for an online or hybrid school: student logins, courses
// with units and lessons (real educational videos), live classes from the
// timetable (past ones ended with attendance and recordings, today's and
// upcoming ones), assignments with a mix of submissions and grades, and
// quizzes with marked attempts. Everything is dated relative to today.
import {
  LessonKind,
  LiveProvider,
  LiveStatus,
  Prisma,
  PrismaClient,
  QuestionKind,
  Role,
  SubmissionStatus,
} from '@prisma/client';
import { startOfLocalDay } from '../../src/common/dates.js';
import { gradeAttempt, type Answers, type Review } from '../../src/elearning/quizzes/quiz-grader.js';
import { studentUsername } from '../../src/students/student-login.js';
import { Random } from './random.js';

export interface EschoolPlan {
  /** Sections whose class level is in this range get courses, live classes and coursework. */
  levels: [number, number];
  /** Subjects taught live from the timetable; every subject when left out (online schools). */
  liveSubjects?: string[];
  /** Who gets a student login: the demo student's whole section, or every student in the school. */
  logins: 'demo-section' | 'all';
  /** Fixed email for the demo student (the first child of the demo family). */
  demoStudentEmail?: string;
}

export interface EschoolInput {
  schoolId: string;
  slug: string;
  academicYearId: string;
  today: string;
  now: Date;
  passwordHash: string;
  sections: { id: string; className: string; name: string; level: number }[];
  subjectId: Map<string, string>;
  /** Teacher (user id) of a subject in a section. */
  teacherOf: (sectionId: string, subject: string) => string | undefined;
  /** Every student, with the admission number their login uses. */
  kids: { id: string; name: string; sectionId: string; ability: number; admissionNo: string }[];
  demoStudentId?: string;
  isSchoolDay: (date: string) => boolean;
}

export interface EschoolSummary {
  logins: number;
  courses: number;
  lessons: number;
  liveClasses: number;
  assignments: number;
  submissions: number;
  quizzes: number;
  attempts: number;
}

const DAY = 86_400_000;
const MIN = 60_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => iso(new Date(new Date(`${s}T00:00:00.000Z`).getTime() + n * DAY));
// School-local wall clock (SCHOOL_TIMEZONE), the same zone the API uses.
const at = (s: string, hour: number, minute = 0) =>
  new Date(startOfLocalDay(s).getTime() + (hour * 60 + minute) * MIN);
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const atTime = (s: string, hhmm: string) => new Date(startOfLocalDay(s).getTime() + minutes(hhmm) * MIN);
const yt = (id: string) => `https://www.youtube.com/watch?v=${id}`;

// ----- Course content -----

interface LessonSeed {
  title: string;
  kind: LessonKind;
  url?: string;
  body?: string;
  durationMin?: number;
  /** Drafts show teachers how unpublished lessons look. */
  draft?: boolean;
}
interface CourseSeed {
  subject: string;
  color: string;
  description: string;
  units: { title: string; lessons: LessonSeed[] }[];
}

/** Khan Academy practice for the class level. */
const khanMath = (level: number) =>
  level <= 5
    ? 'https://www.khanacademy.org/math/cc-fifth-grade-math'
    : level === 6
      ? 'https://www.khanacademy.org/math/cc-sixth-grade-math'
      : level === 7
        ? 'https://www.khanacademy.org/math/cc-seventh-grade-math'
        : level === 8
          ? 'https://www.khanacademy.org/math/cc-eighth-grade-math'
          : 'https://www.khanacademy.org/math/algebra';

const COURSES = (level: number): CourseSeed[] => [
  {
    subject: 'Mathematics',
    color: '#4F46E5',
    description: 'Number skills, fractions and measurement, with short videos and practice after every lesson.',
    units: [
      {
        title: 'Number skills',
        lessons: [
          { title: 'Multiplication refresher', kind: LessonKind.VIDEO, url: yt('mvOkMYCygps'), durationMin: 10 },
          {
            title: 'Times tables: quick tricks',
            kind: LessonKind.TEXT,
            durationMin: 8,
            body:
              '## Tricks worth knowing\n- To multiply by 9, multiply by 10 and take the number away once.\n- To multiply by 5, multiply by 10 and halve it.\n- 4 times a number is double, then double again.\n\nTry these in your copy: 9 x 14, 5 x 36, 4 x 27.',
          },
          { title: 'Addition the long way, step by step', kind: LessonKind.VIDEO, url: yt('AuX7nPBqDts'), durationMin: 8 },
          { title: 'Practice on Khan Academy', kind: LessonKind.LINK, url: khanMath(level), durationMin: 20 },
        ],
      },
      {
        title: 'Fractions and decimals',
        lessons: [
          {
            title: 'Fractions, decimals and percentages',
            kind: LessonKind.TEXT,
            durationMin: 10,
            body:
              'A fraction, a decimal and a percentage can describe the same amount.\n\n1. 1/2 = 0.5 = 50%\n2. 1/4 = 0.25 = 25%\n3. 3/4 = 0.75 = 75%\n\nTo turn a fraction into a decimal, divide the top number by the bottom number. Multiply a decimal by 100 to get a percentage.',
          },
          {
            title: 'Worked examples: word problems',
            kind: LessonKind.TEXT,
            durationMin: 12,
            body:
              '**Example 1.** Ali spends 3/5 of Rs 500 on books. How much is that?\n500 / 5 = 100, and 3 x 100 = Rs 300.\n\n**Example 2.** A shirt costs Rs 1,200 and is 25% off. 25% of 1,200 is 300, so it costs Rs 900.',
          },
          { title: 'Fractions revision sheet', kind: LessonKind.TEXT, body: 'Revision questions for the monthly test. Ready next week.', draft: true },
        ],
      },
    ],
  },
  {
    subject: 'Science',
    color: '#059669',
    description: 'Living things and forces: watch, take notes, then check yourself with the unit quiz.',
    units: [
      {
        title: 'Cells and plants',
        lessons: [
          { title: 'Inside an animal cell', kind: LessonKind.VIDEO, url: yt('cj8dDTHGJBY'), durationMin: 12 },
          { title: 'Photosynthesis', kind: LessonKind.VIDEO, url: yt('sQK3Yr4Sc_k'), durationMin: 13 },
          {
            title: 'Key words for this unit',
            kind: LessonKind.TEXT,
            durationMin: 5,
            body:
              '- **Cell**: the smallest unit of life.\n- **Nucleus**: controls the cell.\n- **Chlorophyll**: the green pigment that traps sunlight.\n- **Photosynthesis**: plants make glucose from carbon dioxide and water using light.\n\nWrite each word with its meaning in your science copy.',
          },
        ],
      },
      {
        title: 'Forces and motion',
        lessons: [
          { title: 'Motion in a straight line', kind: LessonKind.VIDEO, url: yt('ZM8ECpBuQYE'), durationMin: 11 },
          { title: "Newton's laws of motion", kind: LessonKind.VIDEO, url: yt('kKKM8Y-u7ds'), durationMin: 11 },
          { title: 'Explore physics on Khan Academy', kind: LessonKind.LINK, url: 'https://www.khanacademy.org/science/physics', durationMin: 15 },
        ],
      },
    ],
  },
  {
    subject: 'English',
    color: '#0284C7',
    description: 'Reading closely and writing clearly: summaries, letters and new vocabulary.',
    units: [
      {
        title: 'Reading for meaning',
        lessons: [
          {
            title: 'How to read a passage closely',
            kind: LessonKind.TEXT,
            durationMin: 10,
            body:
              '1. Read the questions first so you know what to look for.\n2. Read the passage once without stopping.\n3. Read again and underline the key sentence in each paragraph.\n4. Answer in full sentences, using your own words.',
          },
          { title: 'Stories and reading games', kind: LessonKind.LINK, url: 'https://learnenglishkids.britishcouncil.org/', durationMin: 15 },
        ],
      },
      {
        title: 'Writing',
        lessons: [
          {
            title: 'Writing a summary',
            kind: LessonKind.TEXT,
            durationMin: 10,
            body:
              'A summary is short: about a third of the original.\n\n- Keep the main idea and the important facts.\n- Leave out examples and repetition.\n- Do not add your own opinion.',
          },
          {
            title: 'Informal letters',
            kind: LessonKind.TEXT,
            durationMin: 8,
            body:
              'Start with your address and the date on the right, then "Dear Sana,". Write three short paragraphs: why you are writing, your news, and a friendly ending. Close with "Yours truly," or "Best wishes," and your name.',
          },
        ],
      },
    ],
  },
  {
    subject: 'Computer',
    color: '#D97706',
    description: 'How computers work, from the first machines to binary and logic gates.',
    units: [
      {
        title: 'How computers work',
        lessons: [
          { title: 'Early computing', kind: LessonKind.VIDEO, url: yt('O5nskjZ_GoI'), durationMin: 12 },
          { title: 'Electronic computing', kind: LessonKind.VIDEO, url: yt('LN0ucKNX0hc'), durationMin: 11 },
          {
            title: 'Parts of a computer',
            kind: LessonKind.TEXT,
            durationMin: 6,
            body:
              '- **Input**: keyboard, mouse, microphone.\n- **Processing**: the CPU follows instructions.\n- **Memory**: RAM holds what is in use; storage keeps files.\n- **Output**: screen, printer, speakers.',
          },
        ],
      },
      {
        title: 'Binary and logic',
        lessons: [
          { title: 'Representing numbers in binary', kind: LessonKind.VIDEO, url: yt('1GSjbWt0c9M'), durationMin: 11 },
          { title: 'Boolean logic and logic gates', kind: LessonKind.VIDEO, url: yt('gI-qXk7XojA'), durationMin: 11 },
          { title: 'Learn to code on Khan Academy', kind: LessonKind.LINK, url: 'https://www.khanacademy.org/computing/computer-programming', durationMin: 20 },
        ],
      },
    ],
  },
  {
    subject: 'Social Studies',
    color: '#E11D48',
    description: 'Early civilisations of our region and how people first settled and farmed.',
    units: [
      {
        title: 'Early civilisations',
        lessons: [
          { title: 'The Indus Valley civilisation', kind: LessonKind.VIDEO, url: yt('n7ndRwqJYDM'), durationMin: 11 },
          {
            title: 'Mohenjo-daro and Harappa',
            kind: LessonKind.TEXT,
            durationMin: 8,
            body:
              'Mohenjo-daro (Sindh) and Harappa (Punjab) were planned cities about 4,500 years ago. They had straight streets, covered drains, a Great Bath and houses of baked brick. People traded cotton, beads and pottery as far as Mesopotamia.',
          },
          { title: 'The agricultural revolution', kind: LessonKind.VIDEO, url: yt('Yocja_N5s1I'), durationMin: 11 },
        ],
      },
    ],
  },
];

/** Videos a teacher might share as the recording of a live class in that subject. */
const RECORDINGS: Record<string, string[]> = Object.fromEntries(
  COURSES(6).map((c) => [c.subject, c.units.flatMap((u) => u.lessons.filter((l) => l.kind === LessonKind.VIDEO).map((l) => l.url!))]),
);

// ----- Coursework -----

const ASSIGNMENTS: Record<string, [string, string][]> = {
  Mathematics: [
    ['Fractions worksheet', 'Solve questions 1 to 12 of the fractions worksheet. Show your working for every question.'],
    ['Word problems on percentages', 'Make up three shopping problems using percentages and solve them.'],
    ['Area and perimeter of your room', 'Measure the length and width of your room in metres, then find its area and perimeter.'],
    ['Ratio practice set', 'Complete the ratio practice set from Khan Academy and write the score you got.'],
  ],
  Science: [
    ['Label a plant cell', 'Draw a plant cell and label the cell wall, membrane, nucleus, chloroplast and vacuole.'],
    ['Photosynthesis in your own words', 'Explain photosynthesis in five to eight sentences. Include the word equation.'],
    ['Forces around the house', 'List six pushes or pulls you saw at home and say which force was acting.'],
    ['Water cycle poster', 'Make a poster of the water cycle showing evaporation, condensation and precipitation.'],
  ],
  English: [
    ['Book review', 'Write a review of a story you enjoyed: the plot, your favourite character and who you would recommend it to.'],
    ['Letter to a friend', 'Write an informal letter to a friend about your last holiday (150 to 200 words).'],
    ['Summary of the reading passage', 'Read "The Clever Farmer" from the textbook and write a summary of about 80 words.'],
    ['Ten new words', 'Choose ten new words from this week’s reading and use each in a sentence.'],
  ],
  Computer: [
    ['Convert numbers to binary', 'Convert 5, 12, 19, 27 and 40 into binary. Then convert 1011 and 11010 back into decimal.'],
    ['Draw a logic gate circuit', 'Draw AND, OR and NOT gates and write the truth table for each.'],
    ['Parts of a computer', 'Make a table of five input, five output and three storage devices.'],
    ['An algorithm for making tea', 'Write step-by-step instructions for making a cup of tea, as a computer would follow them.'],
  ],
  'Social Studies': [
    ['Indus Valley timeline', 'Make a timeline of the Indus Valley civilisation with at least six events.'],
    ['Map work: provinces of Pakistan', 'On an outline map, mark the provinces, their capitals and three major rivers.'],
    ['Life in Mohenjo-daro', 'Imagine you lived in Mohenjo-daro. Write a diary entry about one day.'],
    ['Our local government', 'Find out who your union council chairman is and list three things the council does.'],
  ],
};

const SUBMISSION_TEXT = [
  'I have done all the questions. My working is written out below each answer.',
  'Completed. I found the last part difficult but I tried my best.',
  'Here is my work. I checked my answers twice.',
  'Done, Miss. I wrote it neatly and added a diagram.',
  'Attached my answers below. Please let me know if anything is wrong.',
];
const FEEDBACK = {
  high: ['Excellent work, very well explained.', 'Well done, neat and accurate.', 'Very good. Keep it up.'],
  mid: ['Good effort. Check question 4 again.', 'Good, but show your working next time.', 'Nice work. A few small mistakes, see the notes.'],
  low: ['You need more practice here. Come to the doubt-clearing session.', 'Several answers are incomplete. Read the lesson again.'],
  returned: 'Please redo the last part and hand it in again.',
};

interface QuestionSeed {
  kind: QuestionKind;
  prompt: string;
  options?: string[];
  correct: number[] | string[];
  points?: number;
  /** Wrong but sensible SHORT answers a student might type (they wait for the teacher). */
  wrong?: string[];
}
interface QuizSeed {
  subject: string;
  title: string;
  instructions: string;
  timeLimitMin: number;
  attemptsAllowed: number;
  questions: QuestionSeed[];
}

const QUIZZES: QuizSeed[] = [
  {
    subject: 'Mathematics',
    title: 'Fractions and decimals check',
    instructions: 'Fifteen minutes, one attempt. Work out answers in your rough copy first.',
    timeLimitMin: 15,
    attemptsAllowed: 1,
    questions: [
      { kind: QuestionKind.SINGLE, prompt: 'Which fraction is equal to 0.5?', options: ['1/5', '1/2', '3/5', '2/5'], correct: [1] },
      { kind: QuestionKind.SINGLE, prompt: 'What is 25% of 80?', options: ['15', '20', '25', '40'], correct: [1] },
      { kind: QuestionKind.TRUE_FALSE, prompt: '3/4 is greater than 2/3.', options: ['True', 'False'], correct: [0] },
      { kind: QuestionKind.MULTI, prompt: 'Select all fractions equal to 1/2.', options: ['2/4', '3/6', '4/6', '5/10'], correct: [0, 1, 3], points: 2 },
      { kind: QuestionKind.SHORT, prompt: 'Write 3/4 as a decimal.', correct: ['0.75', '.75'], points: 2, wrong: ['0.34', '3.4', '0.7'] },
    ],
  },
  {
    subject: 'Science',
    title: 'Cells and photosynthesis',
    instructions: 'Two attempts allowed; your best score counts. Watch the unit videos first.',
    timeLimitMin: 20,
    attemptsAllowed: 2,
    questions: [
      { kind: QuestionKind.SINGLE, prompt: 'Which part of the cell controls its activities?', options: ['Cell wall', 'Nucleus', 'Vacuole', 'Cytoplasm'], correct: [1] },
      { kind: QuestionKind.SINGLE, prompt: 'Which gas do plants take in for photosynthesis?', options: ['Oxygen', 'Nitrogen', 'Carbon dioxide', 'Hydrogen'], correct: [2] },
      { kind: QuestionKind.TRUE_FALSE, prompt: 'Animal cells have a cell wall.', options: ['True', 'False'], correct: [1] },
      { kind: QuestionKind.MULTI, prompt: 'What does a plant need for photosynthesis?', options: ['Sunlight', 'Water', 'Carbon dioxide', 'Soil'], correct: [0, 1, 2], points: 2 },
      { kind: QuestionKind.SHORT, prompt: 'Name the green pigment in leaves.', correct: ['chlorophyll'], points: 2, wrong: ['chlorophyl', 'chloroplast', 'green colour'] },
    ],
  },
  {
    subject: 'Computer',
    title: 'Binary and logic gates',
    instructions: 'Fifteen minutes. You may use rough paper for conversions.',
    timeLimitMin: 15,
    attemptsAllowed: 1,
    questions: [
      { kind: QuestionKind.SINGLE, prompt: 'What is 5 in binary?', options: ['100', '101', '110', '111'], correct: [1] },
      { kind: QuestionKind.SINGLE, prompt: 'An AND gate outputs 1 when...', options: ['any input is 1', 'both inputs are 1', 'both inputs are 0', 'the inputs differ'], correct: [1] },
      { kind: QuestionKind.TRUE_FALSE, prompt: 'A NOT gate has two inputs.', options: ['True', 'False'], correct: [1] },
      { kind: QuestionKind.SHORT, prompt: 'Write the decimal value of binary 1010.', correct: ['10', 'ten'], points: 2, wrong: ['12', '8'] },
    ],
  },
];

/**
 * Seeds e-school data for the sections of a school the plan covers. Uses its
 * own random stream, so the rest of the school stays exactly as before.
 */
export async function seedEschool(prisma: PrismaClient, plan: EschoolPlan, input: EschoolInput): Promise<EschoolSummary> {
  const { schoolId, today, now } = input;
  const rng = new Random(`${input.slug}:eschool`);
  const summary: EschoolSummary = { logins: 0, courses: 0, lessons: 0, liveClasses: 0, assignments: 0, submissions: 0, quizzes: 0, attempts: 0 };
  const kidsBySection = new Map<string, EschoolInput['kids']>();
  for (const k of input.kids) kidsBySection.set(k.sectionId, [...(kidsBySection.get(k.sectionId) ?? []), k]);
  const ability = new Map(input.kids.map((k) => [k.id, k.ability]));
  const sections = input.sections.filter((s) => s.level >= plan.levels[0] && s.level <= plan.levels[1]);
  const clamp = (v: number) => Math.min(1, Math.max(0, v));

  // ----- Student logins (username = admission number; password123) -----
  const demoSectionId = input.kids.find((k) => k.id === input.demoStudentId)?.sectionId;
  const loginKids = plan.logins === 'all' ? input.kids : input.kids.filter((k) => k.sectionId === demoSectionId);
  const users = await prisma.user.createManyAndReturn({
    data: loginKids.map((k) => ({
      schoolId,
      name: k.name,
      username: studentUsername(k.admissionNo),
      email: k.id === input.demoStudentId ? (plan.demoStudentEmail ?? null) : null,
      passwordHash: input.passwordHash,
      // Most have signed in at some point this week.
      lastLoginAt: k.id === input.demoStudentId || rng.chance(0.7) ? new Date(now.getTime() - rng.int(1, 120) * 60 * MIN) : null,
    })),
    select: { id: true, username: true },
  });
  const userByUsername = new Map(users.map((u) => [u.username, u.id]));
  await prisma.roleAssignment.createMany({ data: users.map((u) => ({ userId: u.id, role: Role.STUDENT })) });
  for (const k of loginKids) {
    await prisma.student.update({ where: { id: k.id }, data: { userId: userByUsername.get(studentUsername(k.admissionNo))! } });
  }
  summary.logins = users.length;

  // ----- Courses, units and lessons -----
  const courseRows: Prisma.CourseCreateManyInput[] = [];
  const courseSeeds: CourseSeed[] = [];
  for (const s of sections) {
    for (const c of COURSES(s.level)) {
      const subjectId = input.subjectId.get(c.subject);
      if (!subjectId) continue;
      courseRows.push({
        schoolId,
        academicYearId: input.academicYearId,
        sectionId: s.id,
        subjectId,
        teacherId: input.teacherOf(s.id, c.subject) ?? null,
        title: c.subject,
        description: c.description,
        color: c.color,
        isPublished: true,
        createdAt: at(addDays(today, -40), 10),
      });
      courseSeeds.push(c);
    }
  }
  const courses = await prisma.course.createManyAndReturn({ data: courseRows, select: { id: true, sectionId: true, subjectId: true } });
  summary.courses = courses.length;
  const courseOf = new Map(courses.map((c) => [`${c.sectionId}|${c.subjectId}`, c.id]));
  const units = await prisma.courseUnit.createManyAndReturn({
    data: courses.flatMap((c, i) => courseSeeds[i].units.map((u, n) => ({ courseId: c.id, title: u.title, sortOrder: n }))),
    select: { id: true, courseId: true, sortOrder: true },
  });
  const unitId = new Map(units.map((u) => [`${u.courseId}|${u.sortOrder}`, u.id]));
  const lessonRows: Prisma.LessonCreateManyInput[] = [];
  courses.forEach((c, i) => {
    let ago = 35;
    courseSeeds[i].units.forEach((u, n) =>
      u.lessons.forEach((l, m) => {
        ago -= rng.int(2, 4);
        const published = !l.draft;
        lessonRows.push({
          unitId: unitId.get(`${c.id}|${n}`)!,
          title: l.title,
          kind: l.kind,
          url: l.url ?? null,
          body: l.body ?? null,
          durationMin: l.durationMin ?? null,
          sortOrder: m,
          isPublished: published,
          publishedAt: published ? at(addDays(today, -Math.max(1, ago)), 9) : null,
          createdAt: at(addDays(today, -Math.max(1, ago) - 1), 16),
        });
      }),
    );
  });
  const lessons = await prisma.lesson.createManyAndReturn({
    data: lessonRows,
    select: { id: true, unitId: true, sortOrder: true, isPublished: true, publishedAt: true },
  });
  summary.lessons = lessons.length;

  // Progress: stronger students are further along; lessons are done in order.
  const unitCourse = new Map(units.map((u) => [u.id, u]));
  const lessonsByCourse = new Map<string, typeof lessons>();
  for (const l of lessons) {
    const u = unitCourse.get(l.unitId)!;
    lessonsByCourse.set(u.courseId, [...(lessonsByCourse.get(u.courseId) ?? []), l]);
  }
  const progress: Prisma.LessonProgressCreateManyInput[] = [];
  for (const c of courses) {
    const ordered = (lessonsByCourse.get(c.id) ?? [])
      .filter((l) => l.isPublished)
      .sort((a, b) => unitCourse.get(a.unitId)!.sortOrder - unitCourse.get(b.unitId)!.sortOrder || a.sortOrder - b.sortOrder);
    for (const k of kidsBySection.get(c.sectionId) ?? []) {
      // The demo student is part-way through, so there is always a "next lesson".
      const share = k.id === input.demoStudentId ? 0.6 : clamp(rng.normal(k.ability, 0.2));
      const done = Math.min(ordered.length, Math.round(ordered.length * share));
      for (const l of ordered.slice(0, done)) {
        const from = l.publishedAt!.getTime();
        progress.push({
          lessonId: l.id,
          studentId: k.id,
          completedAt: new Date(Math.min(now.getTime() - 30 * MIN, from + rng.int(2, 72) * 60 * MIN)),
        });
      }
    }
  }
  for (let i = 0; i < progress.length; i += 5000) await prisma.lessonProgress.createMany({ data: progress.slice(i, i + 5000) });

  // ----- Live classes from the timetable: two weeks back, one week ahead -----
  const sectionIds = new Set(sections.map((s) => s.id));
  const slots = (
    await prisma.timetableSlot.findMany({
      where: { schoolId, sectionId: { in: [...sectionIds] } },
      include: { period: true, subject: true },
    })
  ).filter((t) => !plan.liveSubjects || plan.liveSubjects.includes(t.subject.name));
  const room = () => {
    const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 10 }, () => chars[rng.int(0, chars.length - 1)]).join('');
  };
  const jitsi = () => `https://meet.jit.si/SchoolSyncer-${input.slug}-${room()}`;
  interface LiveDraft {
    row: Prisma.LiveClassCreateManyInput;
    sectionId: string;
  }
  const drafts: LiveDraft[] = [];
  const liveRow = (
    sectionId: string,
    subject: string | null,
    title: string,
    startsAt: Date,
    durationMin: number,
    teacherId: string | null,
    timetableSlotId: string | null,
    provider: LiveProvider = LiveProvider.JITSI,
  ) => {
    const endsAt = new Date(startsAt.getTime() + durationMin * MIN);
    const past = endsAt <= now;
    const running = !past && startsAt <= now;
    // A few classes get called off: some past ones, and one coming up.
    // Rolls are drawn whatever the status, so the time of day the seed runs only changes statuses.
    const cancelRoll = rng.next();
    const recordingRoll = rng.next();
    const cancelled = !running && cancelRoll < (past ? 0.04 : 0.02);
    const status = cancelled ? LiveStatus.CANCELLED : past ? LiveStatus.ENDED : running ? LiveStatus.LIVE : LiveStatus.SCHEDULED;
    const recordings = subject ? (RECORDINGS[subject] ?? []) : [];
    const recording = recordings.length ? rng.pick(recordings) : null;
    drafts.push({
      sectionId,
      row: {
        schoolId,
        sectionId,
        subjectId: subject ? input.subjectId.get(subject)! : null,
        teacherId,
        title,
        startsAt,
        durationMin,
        provider,
        joinUrl:
          provider === LiveProvider.GOOGLE_MEET
            ? `https://meet.google.com/${room().toLowerCase().slice(0, 3)}-${room().toLowerCase().slice(0, 4)}-${room().toLowerCase().slice(0, 3)}`
            : jitsi(),
        status,
        recordingUrl: status === LiveStatus.ENDED && recordingRoll < 0.6 ? recording : null,
        timetableSlotId,
        startedAt: status === LiveStatus.ENDED || status === LiveStatus.LIVE ? new Date(startsAt.getTime() + rng.int(0, 3) * MIN) : null,
        endedAt: status === LiveStatus.ENDED ? new Date(endsAt.getTime() + rng.int(-2, 5) * MIN) : null,
        createdAt: new Date(startsAt.getTime() - rng.int(2, 6) * DAY),
      },
    });
  };
  for (let d = addDays(today, -14); d <= addDays(today, 7); d = addDays(d, 1)) {
    if (!input.isSchoolDay(d)) continue;
    const dow = new Date(`${d}T00:00:00.000Z`).getUTCDay();
    for (const t of slots.filter((x) => x.dayOfWeek === dow)) {
      const subject = t.subject.name;
      liveRow(
        t.sectionId,
        subject,
        subject,
        atTime(d, t.period.startTime),
        minutes(t.period.endTime) - minutes(t.period.startTime),
        t.teacherId ?? input.teacherOf(t.sectionId, subject) ?? null,
        t.id,
      );
    }
  }
  // Extra sessions outside the timetable, so every section has something this evening and later this week.
  for (const s of sections) {
    liveRow(s.id, 'Mathematics', 'Doubt-clearing session: Mathematics', at(today, 17), 45, input.teacherOf(s.id, 'Mathematics') ?? null, null);
    liveRow(s.id, 'Science', 'Science revision before the quiz', at(addDays(today, 2), 16, 30), 40, input.teacherOf(s.id, 'Science') ?? null, null, LiveProvider.GOOGLE_MEET);
  }
  const lives = await prisma.liveClass.createManyAndReturn({
    data: drafts.map((d) => d.row),
    select: { id: true, sectionId: true, status: true, startsAt: true, durationMin: true },
  });
  summary.liveClasses = lives.length;
  const liveAttendance: Prisma.LiveAttendanceCreateManyInput[] = [];
  for (const [i, l] of lives.entries()) {
    // Each class has its own random stream, so attendance doesn't shift with the clock.
    const roll = new Random(`${input.slug}:live:${i}`);
    if (l.status !== LiveStatus.ENDED && l.status !== LiveStatus.LIVE) continue;
    for (const k of kidsBySection.get(l.sectionId) ?? []) {
      if (!roll.chance(0.55 + 0.4 * k.ability)) continue;
      const joinedAt = new Date(Math.min(now.getTime(), l.startsAt.getTime() + roll.int(-4, 8) * MIN));
      liveAttendance.push({
        liveClassId: l.id,
        studentId: k.id,
        joinedAt,
        leftAt: l.status === LiveStatus.ENDED ? new Date(l.startsAt.getTime() + (l.durationMin + roll.int(-6, 2)) * MIN) : null,
      });
    }
  }
  for (let i = 0; i < liveAttendance.length; i += 5000) await prisma.liveAttendance.createMany({ data: liveAttendance.slice(i, i + 5000) });

  // ----- Assignments: one graded, one being marked, one due soon, one later, per course -----
  const assignmentRows: Prisma.AssignmentCreateManyInput[] = [];
  const stages: ('graded' | 'marking' | 'soon' | 'later')[] = [];
  for (const s of sections) {
    for (const [subject, list] of Object.entries(ASSIGNMENTS)) {
      const subjectId = input.subjectId.get(subject);
      if (!subjectId || !courseOf.has(`${s.id}|${subjectId}`)) continue;
      const pick = rng.shuffle(list);
      const plan4: [typeof stages[number], number, boolean][] = [
        ['graded', -10, true],
        ['marking', -2, true],
        ['soon', 2 + rng.int(0, 2), true],
        ['later', 8, rng.chance(0.8)],
      ];
      plan4.forEach(([stage, due, published], i) => {
        assignmentRows.push({
          schoolId,
          sectionId: s.id,
          subjectId,
          courseId: courseOf.get(`${s.id}|${subjectId}`)!,
          createdById: input.teacherOf(s.id, subject) ?? null,
          title: pick[i][0],
          instructions: pick[i][1],
          dueAt: at(addDays(today, due), 20),
          maxPoints: subject === 'Mathematics' || subject === 'Computer' ? 20 : 10,
          // Science work closes at the deadline, to show "missing".
          allowLate: subject !== 'Science',
          isPublished: published,
          createdAt: at(addDays(today, due - 7), 13),
        });
        stages.push(stage);
      });
    }
  }
  const assignments = await prisma.assignment.createManyAndReturn({
    data: assignmentRows,
    select: { id: true, sectionId: true, dueAt: true, maxPoints: true, createdById: true, isPublished: true },
  });
  summary.assignments = assignments.length;
  const submissions: Prisma.SubmissionCreateManyInput[] = [];
  assignments.forEach((a, i) => {
    const stage = stages[i];
    if (!a.isPublished || stage === 'later') return;
    for (const k of kidsBySection.get(a.sectionId) ?? []) {
      const demo = k.id === input.demoStudentId;
      const handIn = demo
        ? stage !== 'soon'
        : rng.chance(stage === 'graded' ? 0.6 + 0.35 * k.ability : stage === 'marking' ? 0.45 + 0.35 * k.ability : 0.3);
      if (!handIn) continue;
      const due = a.dueAt.getTime();
      const late = !demo && stage !== 'soon' && rng.chance(0.12);
      const submittedAt = new Date(
        Math.min(now.getTime() - 20 * MIN, late ? due + rng.int(2, 30) * 60 * MIN : due - rng.int(1, 60) * 60 * MIN),
      );
      const score = Math.round(a.maxPoints * clamp(rng.normal(k.ability, 0.1)));
      const graded = stage === 'graded' || (stage === 'marking' && rng.chance(0.4));
      const returned = graded && !demo && score < a.maxPoints * 0.5 && rng.chance(0.5);
      const band = score >= a.maxPoints * 0.8 ? 'high' : score >= a.maxPoints * 0.55 ? 'mid' : 'low';
      submissions.push({
        assignmentId: a.id,
        studentId: k.id,
        body: rng.pick(SUBMISSION_TEXT),
        submittedAt,
        isLate: submittedAt.getTime() > due,
        status: returned ? SubmissionStatus.RETURNED : graded ? SubmissionStatus.GRADED : SubmissionStatus.SUBMITTED,
        points: graded ? score : null,
        feedback: returned ? FEEDBACK.returned : graded ? rng.pick(FEEDBACK[band]) : null,
        gradedById: graded ? a.createdById : null,
        gradedAt: graded ? new Date(Math.min(now.getTime() - 10 * MIN, Math.max(submittedAt.getTime(), due) + rng.int(4, 40) * 60 * MIN)) : null,
      });
    }
  });
  for (let i = 0; i < submissions.length; i += 5000) await prisma.submission.createMany({ data: submissions.slice(i, i + 5000) });
  summary.submissions = submissions.length;

  // ----- Quizzes: maths closed last week, science open now, computer opens soon -----
  const windows: Record<string, { opens: Date; closes: Date; take: number }> = {
    Mathematics: { opens: at(addDays(today, -9), 8), closes: at(addDays(today, -5), 20), take: 0.85 },
    Science: { opens: at(addDays(today, -1), 8), closes: at(addDays(today, 4), 20), take: 0.4 },
    Computer: { opens: at(addDays(today, 2), 8), closes: at(addDays(today, 6), 20), take: 0 },
  };
  const quizRows: Prisma.QuizCreateManyInput[] = [];
  const quizSeeds: QuizSeed[] = [];
  for (const s of sections) {
    for (const q of QUIZZES) {
      const subjectId = input.subjectId.get(q.subject);
      if (!subjectId || !courseOf.has(`${s.id}|${subjectId}`)) continue;
      const w = windows[q.subject];
      quizRows.push({
        schoolId,
        sectionId: s.id,
        subjectId,
        courseId: courseOf.get(`${s.id}|${subjectId}`)!,
        createdById: input.teacherOf(s.id, q.subject) ?? null,
        title: q.title,
        instructions: q.instructions,
        timeLimitMin: q.timeLimitMin,
        opensAt: w.opens,
        closesAt: w.closes,
        attemptsAllowed: q.attemptsAllowed,
        shuffleQuestions: q.subject === 'Science',
        showResults: true,
        isPublished: true,
        createdAt: new Date(w.opens.getTime() - 3 * DAY),
      });
      quizSeeds.push(q);
    }
  }
  const quizzes = await prisma.quiz.createManyAndReturn({ data: quizRows, select: { id: true, sectionId: true, opensAt: true, closesAt: true } });
  summary.quizzes = quizzes.length;
  const questions = await prisma.quizQuestion.createManyAndReturn({
    data: quizzes.flatMap((z, i) =>
      quizSeeds[i].questions.map((q, n) => ({
        quizId: z.id,
        kind: q.kind,
        prompt: q.prompt,
        options: (q.kind === QuestionKind.SHORT ? [] : q.options!) as Prisma.InputJsonValue,
        correct: q.correct as Prisma.InputJsonValue,
        points: q.points ?? 1,
        sortOrder: n,
      })),
    ),
    select: { id: true, quizId: true, kind: true, options: true, correct: true, points: true, sortOrder: true },
  });
  const questionsByQuiz = new Map<string, typeof questions>();
  for (const q of questions) questionsByQuiz.set(q.quizId, [...(questionsByQuiz.get(q.quizId) ?? []), q]);
  const attempts: Prisma.QuizAttemptCreateManyInput[] = [];
  quizzes.forEach((z, i) => {
    const seed = quizSeeds[i];
    const w = windows[seed.subject];
    const qs = (questionsByQuiz.get(z.id) ?? []).sort((a, b) => a.sortOrder - b.sortOrder);
    const closed = w.closes <= now;
    for (const k of kidsBySection.get(z.sectionId) ?? []) {
      // The demo student has done the closed quiz and left the open one to try.
      const demo = k.id === input.demoStudentId;
      if (demo ? !closed : !rng.chance(w.take)) continue;
      const answers: Answers = {};
      qs.forEach((q, n) => {
        const right = rng.chance(clamp((ability.get(k.id) ?? 0.7) + 0.1));
        const s = seed.questions[n];
        if (q.kind === QuestionKind.SHORT) {
          answers[q.id] = right ? (s.correct[0] as string) : rng.pick(s.wrong ?? ['']);
        } else {
          const key = s.correct as number[];
          const count = s.options!.length;
          if (right) answers[q.id] = key;
          else if (q.kind === QuestionKind.MULTI) answers[q.id] = key.slice(0, 1);
          else answers[q.id] = [(key[0] + rng.int(1, count - 1)) % count];
        }
      });
      // Closed quiz: the teacher has reviewed typed answers (half marks for a near miss).
      const pending = qs.filter((q) => q.kind === QuestionKind.SHORT && gradeAttempt([q], answers).needsReview);
      const review: Review | null = closed && pending.length ? Object.fromEntries(pending.map((q) => [q.id, Math.floor(q.points / 2)])) : null;
      const grade = gradeAttempt(qs, answers, review ?? {});
      const windowStart = z.opensAt!.getTime();
      const windowEnd = Math.min(z.closesAt!.getTime(), now.getTime() - (seed.timeLimitMin + 5) * MIN);
      if (windowEnd <= windowStart) continue;
      const startedAt = new Date(windowStart + Math.floor(rng.next() * (windowEnd - windowStart)));
      attempts.push({
        quizId: z.id,
        studentId: k.id,
        startedAt,
        submittedAt: new Date(startedAt.getTime() + rng.int(4, seed.timeLimitMin - 1) * MIN),
        answers: answers as Prisma.InputJsonValue,
        review: review ? (review as Prisma.InputJsonValue) : undefined,
        score: grade.score,
        maxScore: grade.maxScore,
        needsReview: grade.needsReview,
      });
    }
  });
  for (let i = 0; i < attempts.length; i += 5000) await prisma.quizAttempt.createMany({ data: attempts.slice(i, i + 5000) });
  summary.attempts = attempts.length;
  return summary;
}
