// HR extras: the CV bank, approved short leaves and experience certificates.
import { CandidateStatus, LeaveStatus, type Prisma, PrismaClient } from '@prisma/client';
import { daysBefore } from '../../src/common/dates.js';
import { nextSerial, verifyCode } from '../../src/certificates/certificate-rules.js';
import type { Random } from './random.js';

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const addDays = (s: string, n: number) => daysBefore(s, -n);

const POSITIONS = ['Maths teacher', 'Science teacher', 'English teacher', 'Urdu teacher', 'Computer teacher', 'Primary class teacher', 'Receptionist', 'Accounts clerk'];
const QUALIFICATIONS = ['MSc Mathematics', 'MSc Physics', 'MA English', 'MA Urdu', 'BS Computer Science', 'B.Ed', 'M.Com', 'FA'];
const SOURCES = ['Referral', 'Walk-in', 'Rozee.pk', 'Facebook', 'Walk-in', 'Referral'];
const NAMES = ['Sana Iqbal', 'Omar Farooq', 'Mehreen Tariq', 'Hamza Sheikh', 'Aiman Rauf', 'Usman Ghani', 'Rabia Anwar', 'Talha Mehmood', 'Nimra Zahid', 'Fahad Qureshi'];
const STATUSES = [CandidateStatus.NEW, CandidateStatus.NEW, CandidateStatus.SHORTLISTED, CandidateStatus.INTERVIEWED, CandidateStatus.OFFERED, CandidateStatus.REJECTED, CandidateStatus.SHORTLISTED, CandidateStatus.NEW, CandidateStatus.HIRED, CandidateStatus.REJECTED];

export async function seedHr(
  prisma: PrismaClient,
  rng: Random,
  input: {
    schoolId: string;
    issuedById: string;
    today: string;
    staff: { id: string; joinedOn: string }[];
    schoolDays: string[];
  },
) {
  const { schoolId } = input;

  const candidates = NAMES.map((name, i) => {
    const k = i % POSITIONS.length;
    return {
      schoolId,
      name,
      phone: `03${rng.pick(['00', '01', '21', '33', '45'])}${rng.digits(7)}`,
      email: `${name.toLowerCase().replace(/\W+/g, '.')}@example.pk`,
      position: POSITIONS[k],
      qualification: QUALIFICATIONS[k],
      experienceYears: rng.int(0, 9),
      expectedSalary: Math.round(rng.int(30000, 70000) / 1000) * 1000,
      source: rng.pick(SOURCES),
      status: STATUSES[i],
      notes: i % 3 === 0 ? 'Good demo lesson; follow up on references.' : null,
      createdAt: new Date(`${addDays(input.today, -rng.int(2, 60))}T10:00:00.000Z`),
    };
  });
  await prisma.candidate.createMany({ data: candidates });

  // Short leaves in the past (approved) and one waiting for a decision.
  const past = input.schoolDays.filter((d) => d < addDays(input.today, -2));
  const people = rng.shuffle(input.staff).slice(0, Math.min(6, input.staff.length));
  const leaves: Prisma.ShortLeaveCreateManyInput[] = people.flatMap((s, i) =>
    Array.from({ length: i % 3 === 0 ? 3 : 1 }, () => ({
      schoolId,
      userId: s.id,
      date: day(rng.pick(past)),
      fromTime: '11:00',
      toTime: rng.pick(['12:30', '13:00', '14:00']),
      reason: rng.pick(['Bank work', 'Doctor’s appointment', 'Parent-teacher meeting at own child’s school', 'Passport office']),
      status: LeaveStatus.APPROVED,
      decidedAt: new Date(`${addDays(input.today, -3)}T09:00:00.000Z`),
    })),
  );
  const waiting = input.staff.find((s) => !people.includes(s));
  if (waiting) {
    leaves.push({
      schoolId,
      userId: waiting.id,
      date: day(addDays(input.today, 2)),
      fromTime: '10:30',
      toTime: '12:00',
      reason: 'Dentist',
      status: LeaveStatus.PENDING,
    });
  }
  await prisma.shortLeave.createMany({ data: leaves });

  // Two experience certificates, one for someone who left.
  const certified = input.staff.slice(0, 2);
  const profiles = await prisma.staffProfile.findMany({
    where: { userId: { in: certified.map((s) => s.id) } },
    include: { user: { select: { name: true } } },
  });
  const issued: string[] = [];
  for (const [i, p] of profiles.entries()) {
    const leftOn = i === 0 ? addDays(input.today, -20) : null;
    const serialNo = nextSerial('EXPERIENCE', Number(input.today.slice(0, 4)), issued);
    issued.push(serialNo);
    await prisma.staffCertificate.create({
      data: {
        schoolId,
        userId: p.userId,
        serialNo,
        verifyCode: verifyCode(),
        issuedOn: day(addDays(input.today, -1)),
        issuedById: input.issuedById,
        details: {
          staffName: p.user.name,
          employeeNo: p.employeeNo,
          designation: p.designation,
          department: p.department,
          cnic: p.cnic,
          joinedOn: p.joinedOn?.toISOString().slice(0, 10) ?? '2020-01-01',
          leftOn,
          conduct: 'Very good',
          remarks: i === 0 ? 'Left on her own request.' : null,
        },
      },
    });
  }
  // Approved short leaves per `${userId}|${YYYY-MM}`, for the payslips already run.
  const shortLeaveCounts = new Map<string, number>();
  for (const l of leaves) {
    if (l.status !== LeaveStatus.APPROVED) continue;
    const key = `${l.userId}|${(l.date as Date).toISOString().slice(0, 7)}`;
    shortLeaveCounts.set(key, (shortLeaveCounts.get(key) ?? 0) + 1);
  }
  return { candidates: candidates.length, shortLeaves: leaves.length, certificates: profiles.length, shortLeaveCounts };
}
