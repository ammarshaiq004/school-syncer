// A front desk's visitor book, post register, short leave, complaints, phone book and localities.
import { ComplaintStatus, PostalDirection, PrismaClient, StudentStatus } from '@prisma/client';
import { daysBefore } from '../../src/common/dates.js';
import type { Random } from './random.js';

const LOCALITIES = [
  'Model Town', 'Johar Town', 'Gulberg', 'Bahria Town', 'Wapda Town', 'DHA Phase 5', 'Samanabad', 'Garden Town',
];
const PURPOSES = [
  'Admission enquiry', 'Fee query', 'Meet class teacher', 'Meet principal', 'Collect documents', 'Parent meeting',
  'Vendor delivery', 'Maintenance work', 'Inspection',
];
const MEET = ['Principal', 'Accounts office', 'Class teacher', 'Admission office', 'Admin office'];
const NAMES = ['Mr Rashid', 'Mrs Nasreen', 'Mr Akram', 'Mrs Farida', 'Mr Javed', 'Mr Tariq', 'Mrs Shaista', 'Mr Imtiaz', 'Mrs Rukhsana', 'Mr Shabbir'];
const PARTIES = ['Punjab Education Department', 'BISE Lahore', 'TCS Courier', 'Ferozsons Publishers', 'Oxford University Press', 'Parent', 'Bank branch', 'FBR'];
const SUBJECTS = ['Exam schedule circular', 'Textbook order', 'Fee challan copy', 'Registration forms', 'Inspection notice', 'Teacher training invitation', 'Tax notice', 'Result gazette'];
const REASONS = ['Doctor appointment', 'Not feeling well', 'Family function', 'Dental check-up', 'Passport office visit'];
const COMPLAINTS: [string, string][] = [
  ['Transport', 'Van arrives late most mornings.'],
  ['Fees', 'Late fine charged although the fee was paid on the due date.'],
  ['Academics', 'Homework load is too heavy for the junior section.'],
  ['Facilities', 'Water cooler on the first floor is not working.'],
  ['Staff conduct', 'Child says the teacher shouted in class.'],
  ['Discipline', 'Bullying reported on the playground.'],
];
const CONTACTS: [string, string | null, string, string][] = [
  ['Dr Sana Malik', 'Shifa Clinic', 'Medical', '042-35761234'],
  ['Rescue 1122', null, 'Emergency', '1122'],
  ['Police station (local)', null, 'Emergency', '15'],
  ['BISE Lahore helpdesk', 'BISE Lahore', 'Board office', '042-99200200'],
  ['Ferozsons sales desk', 'Ferozsons', 'Vendor', '042-37310800'],
  ['Al-Noor Stationers', 'Al-Noor Stationers', 'Vendor', '0300-4561230'],
  ['Mr Bashir (plumber)', null, 'Maintenance', '0321-7654321'],
  ['Mr Nadeem (electrician)', null, 'Maintenance', '0333-1122334'],
  ['School van mechanic', 'City Garage', 'Transport', '0345-9988776'],
  ['PTCL support', 'PTCL', 'Utilities', '1218'],
];

export async function seedFrontOffice(
  prisma: PrismaClient,
  rng: Random,
  schoolId: string,
  today: string,
  schoolDays: string[],
) {
  const students = await prisma.student.findMany({
    where: { schoolId, status: StudentStatus.ACTIVE },
    select: { id: true, campusId: true },
  });
  if (!students.length) return { visitors: 0, postal: 0, shortLeaves: 0, complaints: 0, contacts: 0, localities: 0 };
  const campusId = students[0].campusId;
  const at = (s: string, hour: number, minute = 0) =>
    new Date(`${s}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000+05:00`);
  const days = schoolDays.slice(-25);

  // Localities, spread over the students.
  const localities = [];
  for (const name of LOCALITIES) localities.push(await prisma.locality.create({ data: { schoolId, name } }));
  const shuffled = rng.shuffle(students);
  for (const [i, loc] of localities.entries()) {
    await prisma.student.updateMany({
      where: { id: { in: shuffled.filter((_, n) => n % localities.length === i).map((s) => s.id) } },
      data: { localityId: loc.id },
    });
  }

  await prisma.visitor.createMany({
    data: days.flatMap((d) =>
      Array.from({ length: rng.int(1, 4) }, () => {
        const inAt = at(d, rng.int(8, 13), rng.int(0, 59));
        const stay = rng.int(5, 50);
        const still = d === today && rng.chance(0.3);
        return {
          schoolId,
          campusId,
          name: rng.pick(NAMES),
          phone: `03${rng.int(0, 4)}${rng.digits(8)}`,
          purpose: rng.pick(PURPOSES),
          meetingWith: rng.pick(MEET),
          headcount: rng.chance(0.2) ? 2 : 1,
          cardNo: String(rng.int(1, 40)),
          checkedInAt: inAt,
          checkedOutAt: still ? null : new Date(inAt.getTime() + stay * 60_000),
        };
      }),
    ),
  });

  const postal = Array.from({ length: 30 }, (_, i) => {
    const sent = rng.chance(0.4);
    return {
      schoolId,
      campusId,
      direction: sent ? PostalDirection.SENT : PostalDirection.RECEIVED,
      date: new Date(`${daysBefore(today, i * 3 + rng.int(0, 2))}T00:00:00.000Z`),
      party: rng.pick(PARTIES),
      subject: rng.pick(SUBJECTS),
      referenceNo: rng.chance(0.6) ? `D-${rng.int(100, 999)}` : null,
      mode: sent ? rng.pick(['TCS', 'By hand', 'Registered post']) : null,
    };
  });
  await prisma.postalRecord.createMany({ data: postal });

  const leaves = days.flatMap((d) =>
    Array.from({ length: rng.int(0, 2) }, () => {
      const s = rng.pick(students);
      const left = at(d, rng.int(10, 12), rng.int(0, 59));
      return {
        schoolId,
        campusId: s.campusId,
        studentId: s.id,
        date: new Date(`${d}T00:00:00.000Z`),
        leftAt: left,
        reason: rng.pick(REASONS),
        pickedUpBy: rng.pick(NAMES),
        relation: rng.pick(['Father', 'Mother', 'Uncle', 'Driver']),
        returnedAt: rng.chance(0.15) ? new Date(left.getTime() + 90 * 60_000) : null,
      };
    }),
  );
  await prisma.studentShortLeave.createMany({ data: leaves });

  const complaints = Array.from({ length: 14 }, (_, i) => {
    const [category, description] = COMPLAINTS[i % COMPLAINTS.length];
    const status = rng.pick([ComplaintStatus.OPEN, ComplaintStatus.IN_PROGRESS, ComplaintStatus.RESOLVED, ComplaintStatus.RESOLVED]);
    const created = at(daysBefore(today, i * 2), rng.int(9, 14));
    return {
      schoolId,
      campusId,
      complainant: rng.pick(NAMES),
      phone: `03${rng.int(0, 4)}${rng.digits(8)}`,
      studentId: rng.chance(0.7) ? rng.pick(students).id : null,
      category,
      description,
      status,
      resolution: status === ComplaintStatus.RESOLVED ? 'Discussed with the parent and the issue was fixed.' : null,
      resolvedAt: status === ComplaintStatus.RESOLVED ? new Date(created.getTime() + 2 * 86_400_000) : null,
      createdAt: created,
    };
  });
  await prisma.complaint.createMany({ data: complaints });

  await prisma.contactEntry.createMany({
    data: CONTACTS.map(([name, organisation, category, phone]) => ({ schoolId, name, organisation, category, phone })),
  });

  return {
    visitors: await prisma.visitor.count({ where: { schoolId } }),
    postal: postal.length,
    shortLeaves: leaves.length,
    complaints: complaints.length,
    contacts: CONTACTS.length,
    localities: localities.length,
  };
}
