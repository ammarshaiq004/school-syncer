// Lesson plans and parent-teacher chat for a demo school. Built from what the
// school seed already made (sections, subject teachers, parent logins), so it
// runs after it and is safe to rerun: each part is skipped when the school
// already has lesson plans or chat threads.
import { LessonPlanStatus, Role, type PrismaClient, type Prisma } from '@prisma/client';
import { Random } from './random.js';

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const addDays = (s: string, n: number) => iso(new Date(day(s).getTime() + n * DAY));
/** Monday of the week containing `s`. */
const monday = (s: string) => addDays(s, -((day(s).getUTCDay() + 6) % 7));
/** A wall-clock time in Pakistan on day `s`. */
const at = (s: string, hour: number, minute = 0) =>
  new Date(`${s}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000+05:00`);

/** Topic, objectives, activities, resources and homework, roughly in teaching order. */
type Topic = [string, string, string, string, string];

const TOPICS: Record<string, Topic[]> = {
  Mathematics: [
    ['Fractions: equivalent fractions', 'Recognise and make equivalent fractions; simplify to lowest terms.', 'Fraction strips in pairs; number-line warm-up; exit ticket of five questions.', 'Fraction strips, textbook unit 4, whiteboard.', 'Exercise 4.2, questions 1 to 10.'],
    ['Adding and subtracting fractions', 'Add and subtract fractions with like and unlike denominators.', 'Worked examples on the board; pair practice; quick quiz on mini whiteboards.', 'Textbook unit 4, worksheet 4B.', 'Worksheet 4B, both sides.'],
    ['Decimals and place value', 'Read, write and compare decimals to two places.', 'Place-value chart game; ordering cards in groups; plenary questions.', 'Place-value charts, decimal cards.', 'Exercise 5.1, odd questions.'],
    ['Perimeter and area of rectangles', 'Find perimeter and area; choose the right units.', 'Measure classroom objects; compound shapes challenge in groups.', 'Rulers, squared paper, textbook unit 7.', 'Exercise 7.3 and measure one room at home.'],
    ['Angles and their measurement', 'Measure and draw angles with a protractor; name acute, obtuse and reflex angles.', 'Protractor demonstration; angle hunt around the school; pair checking.', 'Protractors, angle worksheet.', 'Draw and label six angles.'],
    ['Word problems with the four operations', 'Pick the operation from the wording and check answers by estimating.', 'Read-aloud problems; bar-model drawing; group presentation of one solution.', 'Problem cards, textbook review exercise.', 'Five word problems from the review exercise.'],
  ],
  English: [
    ['Reading comprehension: "The Honest Woodcutter"', 'Find main idea and supporting details; infer character feelings.', 'Shared reading; vocabulary wall; question-answer in pairs.', 'Reader chapter 6, dictionary.', 'Answer questions 1 to 6 in the notebook.'],
    ['Parts of speech: adjectives and adverbs', 'Identify adjectives and adverbs and use them to improve sentences.', 'Sentence-building game; highlight in a paragraph; peer edit.', 'Grammar book unit 9, highlighters.', 'Grammar book page 54.'],
    ['Letter writing: a letter to a friend', 'Use the format of an informal letter; write in paragraphs.', 'Model letter analysis; planning grid; first draft in class.', 'Model letter handout.', 'Finish the final draft.'],
    ['Tenses: simple past and past continuous', 'Choose the right past tense in context.', 'Timeline activity; story retelling in pairs; quick check.', 'Grammar book unit 11.', 'Exercise 11A.'],
  ],
  Science: [
    ['States of matter', 'Describe solids, liquids and gases and changes of state.', 'Ice melting demonstration; particle role-play; labelled diagram.', 'Ice, beaker, burner (teacher only), textbook chapter 3.', 'Draw and label the water cycle.'],
    ['Plants: photosynthesis', 'Explain what plants need to make food.', 'Leaf starch test demonstration; discussion; summary notes.', 'Leaves, iodine, textbook chapter 5.', 'Questions at the end of chapter 5.'],
    ['Simple circuits', 'Build a simple circuit and explain conductors and insulators.', 'Group circuit building; testing materials; recording results.', 'Batteries, bulbs, wires, materials tray.', 'Draw a circuit diagram with a switch.'],
  ],
  Urdu: [
    ['سبق: ہمارا پیارا وطن', 'سبق کی روانی سے پڑھائی اور نئے الفاظ کے معنی۔', 'بلند خوانی، الفاظ معنی، سوال جواب۔', 'اردو کی کتاب سبق ۷۔', 'مشق کے سوالات ۱ تا ۵۔'],
    ['قواعد: اسم اور اس کی اقسام', 'اسم معرفہ اور اسم نکرہ کی پہچان۔', 'مثالیں، گروپ کام، تختہ سیاہ پر مشق۔', 'قواعد کی کتاب۔', 'دس مثالیں لکھیں۔'],
  ],
  Islamiat: [
    ['Seerat: kindness of the Prophet (PBUH)', 'Retell events showing kindness and relate them to daily life.', 'Story telling; discussion; class pledge chart.', 'Islamiat textbook chapter 4.', 'Write three ways to be kind at home.'],
    ['Wudu and its importance', 'Know the steps of wudu in order.', 'Step cards ordering; demonstration; recitation of duas.', 'Step cards, textbook.', 'Learn the dua after wudu.'],
  ],
  'Social Studies': [
    ['Maps and directions', 'Use cardinal directions and a map key.', 'Map reading in pairs; treasure-hunt directions in the playground.', 'Atlas, school map handout.', 'Draw a map of the route from home to school.'],
    ['Provinces of Pakistan', 'Name the provinces, capitals and one feature of each.', 'Map labelling; group posters; gallery walk.', 'Atlas, chart paper.', 'Complete the provinces table.'],
  ],
  Computer: [
    ['Introduction to spreadsheets', 'Enter data, use SUM and make a simple chart.', 'Teacher demo; lab practice with class marks data; share charts.', 'Computer lab, sample data file.', 'Write the steps to make a chart.'],
    ['Safe use of the internet', 'Recognise unsafe messages and protect passwords.', 'Scenario cards; discussion; poster in pairs.', 'Scenario cards, projector.', 'Make a list of five safety rules.'],
  ],
  'Nazra Quran': [
    ['Makharij: throat letters', 'Pronounce the throat letters correctly.', 'Listening and repeating; individual recitation; peer listening.', 'Qaida, audio recitation.', 'Practise the page with a parent.'],
  ],
};
/** Early years (Playgroup to Prep) and Grades 6 and up get their own topics where it matters. */
const EARLY_TOPICS: Record<string, Topic[]> = {
  Mathematics: [
    ['Counting objects 1 to 20', 'Count objects reliably and match them to numerals.', 'Counting songs; bead counting in pairs; number cards matching.', 'Counting beads, number cards.', 'Count spoons at home and draw them.'],
    ['Shapes around us', 'Name circle, square, triangle and rectangle.', 'Shape hunt in class; sorting shapes; colouring sheet.', 'Shape blocks, colouring sheet.', 'Find three shapes at home.'],
    ['More and less', 'Compare two groups and say which has more.', 'Hands-on comparing with blocks; picture cards.', 'Blocks, picture cards.', 'Worksheet: circle the bigger group.'],
  ],
  English: [
    ['Phonics: letter sounds s, a, t, p', 'Hear and say the sounds; trace the letters.', 'Jolly phonics song; sand-tray tracing; picture sound sort.', 'Phonics flashcards, sand tray.', 'Trace the letters in the workbook.'],
    ['Rhyming words', 'Recognise and make simple rhymes.', 'Nursery rhymes; rhyme pairs game.', 'Rhyme cards.', 'Say three rhyming pairs to a parent.'],
  ],
  Urdu: [
    ['حروف تہجی: ا سے ث', 'حروف کی پہچان اور آواز۔', 'نظم، فلیش کارڈ، ریت پر لکھائی۔', 'فلیش کارڈ۔', 'کاپی میں حروف لکھیں۔'],
  ],
};
const SENIOR_TOPICS: Record<string, Topic[]> = {
  Mathematics: [
    ['Algebraic expressions', 'Form and simplify expressions; collect like terms.', 'Think-pair-share on writing expressions; card sort; mini quiz.', 'Textbook unit 6, algebra cards.', 'Exercise 6.1, questions 1 to 12.'],
    ['Linear equations in one variable', 'Solve equations with unknowns on both sides and check solutions.', 'Balance model demonstration; graded practice; peer marking.', 'Balance diagram slides, textbook unit 7.', 'Exercise 7.2.'],
    ['Ratio and proportion', 'Simplify ratios and solve direct proportion problems.', 'Recipe scaling activity; worked examples; exit ticket.', 'Recipe cards, textbook unit 3.', 'Exercise 3.4, word problems.'],
    ['Pythagoras theorem', 'Use a^2 + b^2 = c^2 to find a missing side.', 'Square-cutting investigation; examples; real-life ladder problems.', 'Squared paper, scissors, textbook unit 10.', 'Exercise 10.1.'],
    ['Data handling: mean, median and mode', 'Calculate averages and choose the best one.', 'Class height survey; calculate in groups; discuss outliers.', 'Measuring tape, data sheet.', 'Survey family ages and find the averages.'],
  ],
  Science: [
    ['Cells and tissues', 'Compare plant and animal cells and name their parts.', 'Microscope slides of onion skin; labelled drawings.', 'Microscopes, onion, iodine.', 'Questions 1 to 6, chapter 2.'],
    ['Acids, bases and indicators', 'Test substances with litmus and classify them.', 'Group testing of household liquids; results table.', 'Litmus paper, sample liquids.', 'List five acids and bases at home.'],
    ['Force and motion', 'Relate speed, distance and time; describe balanced forces.', 'Toy car ramp experiment; speed calculations.', 'Ramp, toy cars, stopwatch.', 'Exercise on speed calculations.'],
  ],
  English: [
    ['Essay writing: descriptive essay', 'Plan and write a five-paragraph descriptive essay.', 'Model essay analysis; sensory word bank; planning.', 'Model essay, planning sheet.', 'Write the first draft (300 words).'],
    ['Active and passive voice', 'Change sentences between active and passive voice.', 'Sentence transformation relay; newspaper examples.', 'Grammar book unit 14.', 'Exercise 14B.'],
    ['Poetry: "Daffodils" by Wordsworth', 'Explain imagery and the poet\'s feelings.', 'Reading aloud; annotate imagery; group discussion.', 'Poem handout.', 'Answer the comprehension questions.'],
  ],
};
const GENERIC: Topic[] = [['Revision of the unit', 'Consolidate the unit before the monthly test.', 'Recap quiz; group corrections; past questions.', 'Textbook review exercise.', 'Revise the unit for the test.']];

const NEEDS_CHANGES_NOTES = [
  'Please add how you will check understanding at the end of the lesson, and differentiate for the slower group.',
  'Good plan. Kindly split the activities by day and add the textbook page numbers for homework.',
  'Objectives are too broad; make them measurable (what will students be able to do?).',
];
const APPROVED_NOTES = [null, null, 'Well planned, thank you.', 'Nice use of group work.'];

interface PlanRow {
  sectionId: string;
  className: string;
  subjectId: string;
  subject: string;
  teacherId: string;
}

/** Playgroup, Nursery and Prep first, then Grade 1, 2, ... */
const rank = (className: string) =>
  ({ Playgroup: -2, Nursery: -1, Prep: 0 })[className] ?? Number(className.replace(/\D+/g, '') || 99);

function topicsFor(className: string, subject: string): Topic[] {
  const level = rank(className);
  if (level <= 0) return EARLY_TOPICS[subject] ?? TOPICS[subject] ?? GENERIC;
  if (level >= 6) return SENIOR_TOPICS[subject] ?? TOPICS[subject] ?? GENERIC;
  return TOPICS[subject] ?? GENERIC;
}

/** Monday of last week, this week and next week relative to `today`. */
function weeks(today: string) {
  const thisWeek = monday(today);
  return { last: addDays(thisWeek, -7), current: thisWeek, next: addDays(thisWeek, 7) };
}

export async function seedAcademia(
  prisma: PrismaClient,
  slug: string,
  today: string,
  opts: { demoTeacherEmail: string; reviewerEmail: string; demoParent: string; otherTeachers?: number },
  now = new Date(),
) {
  const school = await prisma.school.findUnique({ where: { slug } });
  if (!school) return { lessonPlans: 0, threads: 0, messages: 0 };
  const schoolId = school.id;
  const rng = new Random(`${slug}:academia`);
  const year = await prisma.academicYear.findFirstOrThrow({ where: { schoolId, isCurrent: true } });
  const demoTeacher = await prisma.user.findFirstOrThrow({ where: { schoolId, email: opts.demoTeacherEmail } });
  const reviewer = await prisma.user.findFirstOrThrow({ where: { schoolId, email: opts.reviewerEmail } });

  // ----- Lesson plans -----
  let lessonPlans = 0;
  if ((await prisma.lessonPlan.count({ where: { schoolId } })) === 0) {
    const links = await prisma.sectionSubject.findMany({
      where: { schoolId, teacherId: { not: null }, section: { academicYearId: year.id } },
      include: { subject: true, section: { include: { class: true } } },
      orderBy: [{ section: { class: { sortOrder: 'asc' } } }, { section: { name: 'asc' } }, { subject: { name: 'asc' } }],
    });
    const rowsOf = (teacherId: string): PlanRow[] =>
      links
        .filter((l) => l.teacherId === teacherId)
        .map((l) => ({ sectionId: l.sectionId, className: l.section.class.name, subjectId: l.subjectId, subject: l.subject.name, teacherId }))
        .sort((a, b) => rank(a.className) - rank(b.className));
    const w = weeks(today);
    const data: Prisma.LessonPlanCreateManyInput[] = [];
    const topicIndex = new Map<string, number>();
    const add = (row: PlanRow, weekStart: string, status: LessonPlanStatus) => {
      const bank = topicsFor(row.className, row.subject);
      const key = `${row.sectionId}|${row.subjectId}`;
      const n = topicIndex.get(key) ?? rng.int(0, bank.length - 1);
      topicIndex.set(key, n + 1);
      const [topic, objectives, activities, resources, homework] = bank[n % bank.length];
      // Drafts are written late in the week before; submissions land by Saturday.
      const written = at(addDays(weekStart, -rng.int(3, 6)), rng.int(15, 21), rng.int(0, 59));
      const submittedAt = status === LessonPlanStatus.DRAFT ? null : new Date(written.getTime() + rng.int(1, 20) * 3_600_000);
      const reviewed = status === LessonPlanStatus.APPROVED || status === LessonPlanStatus.NEEDS_CHANGES;
      const reviewedAt = reviewed ? new Date(submittedAt!.getTime() + rng.int(4, 30) * 3_600_000) : null;
      // Nothing may be in the future: clamp to a ceiling a few hours ago, keeping
      // createdAt <= submittedAt <= reviewedAt (each later step at least 10 min on).
      const ceiling = now.getTime() - rng.int(1, 6) * 3_600_000;
      const MIN = 60_000;
      const createdAt = new Date(Math.min(written.getTime(), ceiling - 120 * MIN));
      const submitted = submittedAt
        ? new Date(Math.max(Math.min(submittedAt.getTime(), ceiling - 60 * MIN), createdAt.getTime() + 10 * MIN))
        : null;
      const reviewedOn =
        reviewedAt && submitted
          ? new Date(Math.max(Math.min(reviewedAt.getTime(), ceiling), submitted.getTime() + 10 * MIN))
          : null;
      data.push({
        schoolId,
        sectionId: row.sectionId,
        subjectId: row.subjectId,
        teacherId: row.teacherId,
        weekStart: day(weekStart),
        topic,
        objectives,
        activities,
        resources,
        // Some teachers leave homework for the day itself.
        homework: rng.chance(0.85) ? homework : null,
        status,
        submittedAt: submitted,
        reviewedById: reviewed ? reviewer.id : null,
        reviewedAt: reviewedOn,
        reviewerNote:
          status === LessonPlanStatus.NEEDS_CHANGES ? rng.pick(NEEDS_CHANGES_NOTES) : reviewed ? rng.pick(APPROVED_NOTES) : null,
        createdAt,
      });
    };

    // The demo teacher: everything approved last week, a mix this week, drafts for next week.
    const demoRows = rowsOf(demoTeacher.id);
    const current: LessonPlanStatus[] = [
      LessonPlanStatus.APPROVED,
      LessonPlanStatus.SUBMITTED,
      LessonPlanStatus.NEEDS_CHANGES,
      LessonPlanStatus.APPROVED,
      LessonPlanStatus.SUBMITTED,
    ];
    demoRows.forEach((row, i) => {
      add(row, w.last, LessonPlanStatus.APPROVED);
      add(row, w.current, current[i % current.length]);
      // Next week: a couple already submitted, the rest still drafts (one not started yet).
      if (i < demoRows.length - 1 || demoRows.length === 1) {
        add(row, w.next, i === 0 ? LessonPlanStatus.SUBMITTED : LessonPlanStatus.DRAFT);
      }
    });

    // A few colleagues, so the principal's review queue has something in it.
    const otherIds = [...new Set(links.map((l) => l.teacherId!).filter((id) => id !== demoTeacher.id))];
    for (const teacherId of rng.shuffle(otherIds).slice(0, opts.otherTeachers ?? 5)) {
      for (const row of rowsOf(teacherId).slice(0, 2)) {
        add(row, w.last, rng.chance(0.85) ? LessonPlanStatus.APPROVED : LessonPlanStatus.NEEDS_CHANGES);
        add(row, w.current, rng.pick([LessonPlanStatus.SUBMITTED, LessonPlanStatus.SUBMITTED, LessonPlanStatus.APPROVED, LessonPlanStatus.DRAFT]));
        if (rng.chance(0.5)) add(row, w.next, rng.chance(0.5) ? LessonPlanStatus.SUBMITTED : LessonPlanStatus.DRAFT);
      }
    }
    await prisma.lessonPlan.createMany({ data });
    lessonPlans = data.length;
  }

  // ----- Parent-teacher chat -----
  let threads = 0;
  let messages = 0;
  if ((await prisma.chatThread.count({ where: { schoolId } })) === 0) {
    // Parent logins and their children in this year's sections, with the class and subject teachers.
    const guardians = await prisma.guardian.findMany({
      where: { schoolId, userId: { not: null }, user: { isActive: true, roles: { some: { role: Role.PARENT } } } },
      orderBy: { createdAt: 'asc' },
      include: {
        students: {
          orderBy: { student: { dateOfBirth: 'asc' } },
          include: {
            student: {
              include: {
                enrollments: {
                  where: { academicYearId: year.id, status: 'ACTIVE' },
                  include: { section: { include: { subjects: { include: { subject: true } } } } },
                },
              },
            },
          },
        },
      },
    });
    type Kid = { studentId: string; firstName: string; parentUserId: string; classTeacherId: string | null; teachers: Map<string, string> };
    const kids: Kid[] = guardians.flatMap((g) =>
      g.students.flatMap((sg) => {
        const section = sg.student.enrollments[0]?.section;
        if (!section) return [];
        return [{
          studentId: sg.student.id,
          firstName: sg.student.firstName,
          parentUserId: g.userId!,
          classTeacherId: section.classTeacherId,
          teachers: new Map(section.subjects.filter((s) => s.teacherId).map((s) => [s.teacherId!, s.subject.name])),
        }];
      }),
    );
    const demoParentId = guardians.find((g) => g.name === opts.demoParent)?.userId ?? null;

    type Line = [from: 'parent' | 'staff', text: string];
    const conversations: { kid: Kid; staffId: string; lines: Line[]; startDaysAgo: number; unreadFor: 'parent' | 'staff' | 'none' }[] = [];
    const subjectOf = (k: Kid, staffId: string) => k.teachers.get(staffId) ?? 'class';
    const conversation = (k: Kid, staffId: string, kind: number, startDaysAgo: number, unreadFor: 'parent' | 'staff' | 'none') => {
      const subject = subjectOf(k, staffId);
      const name = k.firstName;
      const scripts: Line[][] = [
        [
          ['parent', `Assalam o Alaikum. ${name} was unwell yesterday and missed school. Could you let me know what was covered so we can help at home?`],
          ['staff', `Walaikum Assalam. I hope ${name} is feeling better. We started a new chapter; I'll send the pages home in the diary today.`],
          ['parent', 'Thank you so much. We will make sure the work is done over the weekend.'],
          ['staff', `${name} has caught up well. Please keep encouraging reading at home for 15 minutes a day.`],
          ['staff', 'Also, the monthly test is next Thursday. The syllabus is in the diary.'],
        ],
        [
          ['parent', `Hello, ${name} found the ${subject === 'class' ? 'homework' : subject + ' homework'} difficult this week. Is there anything we can do at home?`],
          ['staff', `Thanks for telling me. ${name} is doing fine in class, but practice helps. I'll give an extra worksheet with worked examples.`],
          ['parent', 'That would help a lot. Should we also look at the textbook exercises?'],
          ['staff', 'Yes, the solved examples at the start of each exercise are a good place to start.'],
          ['parent', `Thank you. ${name} tried the worksheet last night and found it easier.`],
        ],
        [
          ['staff', `Dear parent, ${name} did very well in today's quiz and helped classmates in group work. Just wanted to share.`],
          ['parent', 'That is lovely to hear, thank you for letting us know!'],
          ['staff', `Please remember to sign the diary for the science trip permission by Friday.`],
          ['parent', 'Will do. Is there anything to bring on the day?'],
        ],
        [
          ['parent', `Could we meet briefly about ${name}'s progress before the parent-teacher meeting?`],
          ['staff', 'Of course. I am free after 12:30 on Tuesday or Wednesday. Which suits you?'],
          ['parent', 'Wednesday at 12:45 works for me.'],
        ],
      ];
      conversations.push({ kid: k, staffId, lines: scripts[kind % scripts.length], startDaysAgo, unreadFor });
    };

    const demoKids = kids.filter((k) => k.parentUserId === demoParentId);
    const firstKid = demoKids[0];
    if (firstKid?.classTeacherId) conversation(firstKid, firstKid.classTeacherId, 0, 9, 'parent');
    // The demo teacher with the demo parent, through whichever child they teach.
    // (When the demo teacher is that class teacher, the thread above already is theirs, so a
    // subject teacher takes this one instead.)
    const taughtByDemo = demoKids.find((k) => k.teachers.has(demoTeacher.id) || k.classTeacherId === demoTeacher.id);
    if (taughtByDemo && !(taughtByDemo === firstKid && firstKid.classTeacherId === demoTeacher.id)) {
      conversation(taughtByDemo, demoTeacher.id, 1, 4, 'staff');
    } else if (firstKid) {
      const other = [...firstKid.teachers.keys()].find((id) => id !== demoTeacher.id);
      if (other) conversation(firstKid, other, 1, 4, 'staff');
    }
    // A subject teacher of the first child, all read.
    const subjectTeacher = firstKid && [...firstKid.teachers.keys()].reverse().find((id) => id !== firstKid.classTeacherId && id !== demoTeacher.id);
    if (firstKid && subjectTeacher) conversation(firstKid, subjectTeacher, 2, 15, 'none');
    // Other parents writing to the demo teacher, so the staff inbox has more than one thread.
    const others = kids.filter((k) => k.parentUserId !== demoParentId && (k.teachers.has(demoTeacher.id) || k.classTeacherId === demoTeacher.id));
    others.slice(0, 2).forEach((k, i) => conversation(k, demoTeacher.id, 3 - i, 2 + i * 5, i === 0 ? 'staff' : 'none'));

    const seen = new Set<string>();
    for (const c of conversations) {
      const key = `${c.kid.studentId}|${c.kid.parentUserId}|${c.staffId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Replies a few hours apart in the daytime, starting `startDaysAgo` days back and
      // pulled earlier if needed so the last one is at least 40 minutes old.
      let t = at(iso(new Date(now.getTime() - c.startDaysAgo * DAY)), rng.int(8, 10), rng.int(0, 59)).getTime();
      const stamps = c.lines.map(() => {
        const s = t;
        t += rng.int(1, 30) * 3_600_000 + rng.int(0, 59) * 60_000;
        // Nobody writes between 10 pm and 8 am: move those to the next morning.
        const hour = (new Date(t).getUTCHours() + 5) % 24;
        if (hour >= 22 || hour < 8) {
          const local = iso(new Date(t + 5 * 3_600_000 + (hour >= 22 ? DAY : 0)));
          t = at(local, 8, rng.int(0, 59)).getTime();
        }
        return s;
      });
      // Seeding at night (Pakistan time)? Then the latest reply is from yesterday evening.
      let latest = now.getTime() - 40 * 60_000;
      const latestHour = (new Date(latest).getUTCHours() + 5) % 24;
      if (latestHour < 8) latest = Math.min(latest, at(iso(new Date(latest + 5 * 3_600_000 - DAY)), 21, 0).getTime());
      const shift = Math.max(0, stamps[stamps.length - 1] - latest);
      const times = stamps.map((s) => new Date(s - shift));
      // The trailing run of messages from one side stays unread by the other side,
      // when the script says that side hasn't opened the thread yet.
      const lastFrom = c.lines[c.lines.length - 1][0];
      let trailingStart = c.lines.length - 1;
      while (trailingStart > 0 && c.lines[trailingStart - 1][0] === lastFrom) trailingStart--;
      const unreadBy = c.unreadFor === 'none' ? null : c.unreadFor;
      const thread = await prisma.chatThread.create({
        data: {
          schoolId,
          studentId: c.kid.studentId,
          guardianUserId: c.kid.parentUserId,
          staffUserId: c.staffId,
          createdAt: times[0],
          lastMessageAt: times[times.length - 1],
        },
      });
      await prisma.chatMessage.createMany({
        data: c.lines.map(([from, body], i) => {
          const recipient = from === 'parent' ? 'staff' : 'parent';
          const unread = i >= trailingStart && unreadBy === recipient;
          // Read when the other side next wrote, or within the hour.
          const readBy = i + 1 < times.length ? times[i + 1].getTime() : times[i].getTime() + rng.int(5, 50) * 60_000;
          return {
            threadId: thread.id,
            senderId: from === 'parent' ? c.kid.parentUserId : c.staffId,
            body,
            createdAt: times[i],
            readAt: unread ? null : new Date(Math.min(readBy - 60_000 * rng.int(0, 5), now.getTime() - 60_000)),
          };
        }),
      });
      threads++;
      messages += c.lines.length;
    }
  }
  return { lessonPlans, threads, messages };
}
