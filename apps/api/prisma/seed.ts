// Seeds a demo school so the web app has something to log in to.
// Login: school "demo-school", email owner@demo.pk, password "password123".
import { PrismaClient, Role } from '@prisma/client';
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
  console.log('Seeded demo-school');
}

await main().finally(() => prisma.$disconnect());
