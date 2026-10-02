// Seeds a demo school so the web app has something to log in to.
// Login: school "demo-school", email owner@demo.pk, password "password123".
import { FeeFrequency, Gender, PrismaClient, Role } from '@prisma/client';
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
  for (const name of ['English', 'Urdu', 'Mathematics', 'Science', 'Islamiat']) {
    await prisma.subject.create({ data: { schoolId: school.id, name } });
  }

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

  await prisma.application.createMany({
    data: [
      { schoolId: school.id, campusId: campus.id, classId: classes[0].id, childName: 'Zainab Iqbal', gender: Gender.FEMALE, guardianName: 'Iqbal Ahmed', guardianPhone: '03211234567', source: 'Facebook' },
      { schoolId: school.id, campusId: campus.id, classId: classes[1].id, childName: 'Usman Tariq', gender: Gender.MALE, guardianName: 'Tariq Mehmood', guardianPhone: '03331234567', source: 'Walk-in', stage: 'TEST_SCHEDULED' },
    ],
  });
  console.log('Seeded demo-school');
}

await main().finally(() => prisma.$disconnect());
