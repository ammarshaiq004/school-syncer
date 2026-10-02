// Seeds a demo school so the web app has something to log in to.
// Login: school "demo-school", email owner@demo.pk (or teacher@demo.pk, accountant@demo.pk), password "password123".
import { FeeFrequency, Gender, LeaveType, PayItemType, PrismaClient, Role, type Period, type Subject } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.school.findUnique({ where: { slug: 'demo-school' } });
  if (existing) {
    console.log('Demo school already exists');
    return;
  }
  const school = await prisma.school.create({
    data: { name: 'Demo School', slug: 'demo-school', city: 'Lahore' },
  });
  const campus = await prisma.campus.create({
    data: { schoolId: school.id, name: 'Main campus' },
  });
  const year = await prisma.academicYear.create({
    data: {
      schoolId: school.id,
      name: '2026-27',
      startsOn: new Date('2026-04-01'),
      endsOn: new Date('2027-03-31'),
      isCurrent: true,
    },
  });
  await prisma.user.create({
    data: {
      schoolId: school.id,
      name: 'Demo Owner',
      email: 'owner@demo.pk',
      passwordHash: await bcrypt.hash('password123', 12),
      roles: { create: { role: Role.OWNER } },
    },
  });
  for (const [i, name] of ['Grade 1', 'Grade 2', 'Grade 3'].entries()) {
    await prisma.class.create({
      data: {
        schoolId: school.id,
        campusId: campus.id,
        name,
        sortOrder: i,
        sections: {
          create: ['A', 'B'].map((s) => ({
            schoolId: school.id,
            academicYearId: year.id,
            name: s,
          })),
        },
      },
    });
  }
  const subjects: Subject[] = [];
  for (const name of ['English', 'Urdu', 'Mathematics', 'Science', 'Islamiat']) {
    subjects.push(await prisma.subject.create({ data: { schoolId: school.id, name } }));
  }
  // One teacher who teaches every subject, so marks entry can be tried as a teacher.
  // Login: teacher@demo.pk / password123.
  const teacher = await prisma.user.create({
    data: {
      schoolId: school.id,
      name: 'Demo Teacher',
      email: 'teacher@demo.pk',
      passwordHash: await bcrypt.hash('password123', 12),
      roles: { create: { role: Role.TEACHER } },
    },
  });

  // Fees: monthly tuition and an annual charge per class.
  const tuition = await prisma.feeHead.create({ data: { schoolId: school.id, name: 'Tuition' } });
  const annual = await prisma.feeHead.create({
    data: { schoolId: school.id, name: 'Annual charges', frequency: FeeFrequency.ANNUAL },
  });
  const classes = await prisma.class.findMany({
    where: { schoolId: school.id },
    include: { sections: true },
    orderBy: { sortOrder: 'asc' },
  });
  for (const [i, c] of classes.entries()) {
    await prisma.feeStructure.createMany({
      data: [
        { schoolId: school.id, classId: c.id, feeHeadId: tuition.id, academicYearId: year.id, amount: 4000 + i * 500 },
        { schoolId: school.id, classId: c.id, feeHeadId: annual.id, academicYearId: year.id, amount: 6000 },
      ],
    });
  }

  // A few students per section, with a guardian each.
  const names = [
    ['Ahmed', 'Khan', Gender.MALE, 'Imran Khan'],
    ['Fatima', 'Ali', Gender.FEMALE, 'Asif Ali'],
    ['Hassan', 'Raza', Gender.MALE, 'Raza Hussain'],
    ['Ayesha', 'Malik', Gender.FEMALE, 'Tariq Malik'],
  ] as const;
  let seq = 1;
  for (const c of classes) {
    for (const section of c.sections) {
      for (const [k, [first, last, gender, guardian]] of names.entries()) {
        const phone = `0300${String(seq).padStart(7, '0')}`;
        await prisma.student.create({
          data: {
            schoolId: school.id,
            campusId: campus.id,
            admissionNo: `2026-${String(seq).padStart(4, '0')}`,
            firstName: first,
            lastName: last,
            gender,
            enrollments: {
              create: { schoolId: school.id, sectionId: section.id, academicYearId: year.id, rollNo: k + 1 },
            },
            guardians: {
              create: {
                relation: 'Father',
                isPrimary: true,
                guardian: { create: { schoolId: school.id, name: guardian, phone } },
              },
            },
          },
        });
        seq++;
      }
    }
  }

  // Every section studies every subject with the demo teacher.
  for (const c of classes) {
    for (const section of c.sections) {
      await prisma.sectionSubject.createMany({
        data: subjects.map((sub) => ({
          schoolId: school.id,
          sectionId: section.id,
          subjectId: sub.id,
          teacherId: teacher.id,
        })),
      });
    }
  }

  // A mid-term with every mark entered, ready to publish from the Exams screen.
  const exam = await prisma.exam.create({
    data: {
      schoolId: school.id,
      academicYearId: year.id,
      name: 'Mid-term 2026',
      startsOn: new Date('2026-09-14'),
      endsOn: new Date('2026-09-25'),
    },
  });
  const enrolled = await prisma.enrollment.findMany({ where: { academicYearId: year.id } });
  for (const c of classes) {
    for (const sub of subjects) {
      const paper = await prisma.examPaper.create({
        data: { examId: exam.id, classId: c.id, subjectId: sub.id, maxMarks: 100, passMarks: 33 },
      });
      const sectionIds = c.sections.map((x) => x.id);
      await prisma.mark.createMany({
        data: enrolled
          .filter((e) => sectionIds.includes(e.sectionId))
          .map((e, n) => ({
            paperId: paper.id,
            studentId: e.studentId,
            marks: 45 + ((n * 17 + sub.name.length * 7) % 55),
          })),
      });
    }
  }

  // A bell schedule and a Monday-to-Friday timetable. Only Grade 1 A has the demo
  // teacher on it, since one teacher can't be in six rooms at once.
  const bell = [
    ['Period 1', '08:00', '08:40'],
    ['Period 2', '08:40', '09:20'],
    ['Period 3', '09:20', '10:00'],
    ['Break', '10:00', '10:30'],
    ['Period 4', '10:30', '11:10'],
    ['Period 5', '11:10', '11:50'],
  ] as const;
  const periods: Period[] = [];
  for (const [i, [name, startTime, endTime]] of bell.entries()) {
    periods.push(
      await prisma.period.create({
        data: { schoolId: school.id, campusId: campus.id, name, startTime, endTime, sortOrder: i + 1, isBreak: name === 'Break' },
      }),
    );
  }
  const teaching = periods.filter((p) => !p.isBreak);
  for (const [ci, c] of classes.entries()) {
    for (const [si, section] of c.sections.entries()) {
      const withTeacher = ci === 0 && si === 0;
      await prisma.timetableSlot.createMany({
        data: [1, 2, 3, 4, 5].flatMap((day) =>
          teaching.map((period, k) => ({
            schoolId: school.id,
            sectionId: section.id,
            dayOfWeek: day,
            periodId: period.id,
            subjectId: subjects[(day + k + ci) % subjects.length].id,
            teacherId: withTeacher ? teacher.id : null,
          })),
        ),
      });
    }
  }
  const firstSection = classes[0].sections[0];
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowDate = new Date(tomorrow.toISOString().slice(0, 10));
  await prisma.homework.create({
    data: {
      schoolId: school.id,
      sectionId: firstSection.id,
      subjectId: subjects[2].id,
      assignedById: teacher.id,
      title: 'Exercise 3.1, questions 1 to 10',
      details: 'Show working in the notebook.',
      dueDate: tomorrowDate,
    },
  });

  // Staff records and pay, so payroll can be run from the HR screen.
  // Login: accountant@demo.pk / password123.
  const accountant = await prisma.user.create({
    data: {
      schoolId: school.id,
      name: 'Demo Accountant',
      email: 'accountant@demo.pk',
      passwordHash: await bcrypt.hash('password123', 12),
      roles: { create: { role: Role.ACCOUNTANT } },
    },
  });
  await prisma.staffProfile.create({
    data: {
      schoolId: school.id,
      userId: teacher.id,
      employeeNo: 'EMP-0001',
      designation: 'Senior teacher',
      department: 'Primary',
      basicSalary: 45000,
      bankName: 'Meezan Bank',
      payItems: {
        create: [
          { name: 'House rent', type: PayItemType.ALLOWANCE, amount: 8000 },
          { name: 'Conveyance', type: PayItemType.ALLOWANCE, amount: 3000 },
          { name: 'Provident fund', type: PayItemType.DEDUCTION, amount: 2250 },
        ],
      },
    },
  });
  await prisma.staffProfile.create({
    data: {
      schoolId: school.id,
      userId: accountant.id,
      employeeNo: 'EMP-0002',
      designation: 'Accountant',
      department: 'Administration',
      basicSalary: 60000,
    },
  });
  await prisma.leaveRequest.create({
    data: {
      schoolId: school.id,
      userId: teacher.id,
      type: LeaveType.CASUAL,
      fromDate: tomorrowDate,
      toDate: tomorrowDate,
      reason: 'Family event',
    },
  });

  await prisma.application.createMany({
    data: [
      { schoolId: school.id, campusId: campus.id, classId: classes[0].id, childName: 'Zainab Iqbal', gender: Gender.FEMALE, guardianName: 'Iqbal Ahmed', guardianPhone: '03211234567', source: 'Facebook' },
      { schoolId: school.id, campusId: campus.id, classId: classes[1].id, childName: 'Usman Tariq', gender: Gender.MALE, guardianName: 'Tariq Mehmood', guardianPhone: '03331234567', source: 'Walk-in', stage: 'TEST_SCHEDULED' },
    ],
  });
  console.log('Seeded demo-school');
}

await main().finally(() => prisma.$disconnect());
