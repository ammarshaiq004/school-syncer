// Children who left during the year with their leaving certificates, and the
// character and enrolment certificates the office issued along the way.
import {
  CertificateType,
  EnrollmentStatus,
  Gender,
  PrismaClient,
  StudentStatus,
  type Prisma,
} from '@prisma/client';
import { daysBefore } from '../../src/common/dates.js';
import {
  certificateDetails,
  studentInclude,
} from '../../src/certificates/certificate-details.js';
import {
  nextSerial,
  verifyCode,
} from '../../src/certificates/certificate-rules.js';
import {
  BOY_NAMES,
  FATHER_NAMES,
  GIRL_NAMES,
  STREETS,
  SURNAMES,
} from './names.js';
import type { Random } from './random.js';

const LEAVING_REASONS = [
  'Family moved to Islamabad',
  'Family moved abroad',
  'Admitted to a school nearer home',
  'Father transferred to Karachi',
  'Parents’ request',
  'Joined a cadet college',
];

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

export async function seedCertificates(
  prisma: PrismaClient,
  rng: Random,
  opts: {
    schoolId: string;
    issuedById: string;
    academicYearId: string;
    yearStart: string;
    today: string;
    phone: () => string;
  },
) {
  const { schoolId, issuedById, yearStart, today } = opts;
  const sections = await prisma.section.findMany({
    where: { schoolId, academicYearId: opts.academicYearId },
    include: { class: { select: { campusId: true, sortOrder: true } } },
  });
  const issued: Prisma.CertificateCreateManyInput[] = [];
  const serials: string[] = [];
  const issue = async (
    studentId: string,
    type: CertificateType,
    on: string,
    extra: { conduct: string; leavingOn?: string; reason?: string },
  ) => {
    const student = await prisma.student.findUniqueOrThrow({
      where: { id: studentId },
      include: studentInclude,
    });
    const details = {
      ...certificateDetails(student, { conduct: extra.conduct }),
      ...(extra.leavingOn
        ? { leavingOn: extra.leavingOn, reason: extra.reason, duesOwed: 0 }
        : {}),
    };
    const serialNo = nextSerial(type, Number(on.slice(0, 4)), serials);
    serials.push(serialNo);
    issued.push({
      schoolId,
      studentId,
      type,
      serialNo,
      verifyCode: verifyCode(),
      issuedOn: day(on),
      details,
      issuedById,
    });
  };

  // Leavers: on the rolls at the start of the year, gone with a certificate since.
  const leaverCount = Math.max(3, Math.round(sections.length / 6));
  const jobs: { on: string; run: (on: string) => Promise<void> }[] = [];
  for (let i = 0; i < leaverCount; i++) {
    const section = rng.pick(sections.filter((s) => s.class.sortOrder > 2));
    const girl = rng.chance(0.5);
    const surname = rng.pick(SURNAMES);
    const admitYear = Number(yearStart.slice(0, 4)) - rng.int(1, 5);
    const leavingOn = daysBefore(today, rng.int(5, 150));
    if (leavingOn <= daysBefore(yearStart, -10)) continue;
    const father = await prisma.guardian.create({
      data: {
        schoolId,
        name: `${rng.pick(FATHER_NAMES)} ${surname}`,
        phone: opts.phone(),
      },
    });
    const student = await prisma.student.create({
      data: {
        schoolId,
        campusId: section.class.campusId,
        admissionNo: `${admitYear}-${String(900 + i).padStart(4, '0')}`,
        firstName: rng.pick(girl ? GIRL_NAMES : BOY_NAMES),
        lastName: surname,
        gender: girl ? Gender.FEMALE : Gender.MALE,
        dateOfBirth: day(
          `${Number(yearStart.slice(0, 4)) - 3 - section.class.sortOrder}-${String(rng.int(1, 12)).padStart(2, '0')}-${String(rng.int(1, 28)).padStart(2, '0')}`,
        ),
        address: `House ${rng.int(1, 400)}, ${rng.pick(STREETS)}`,
        status: StudentStatus.LEFT,
        admittedOn: day(`${admitYear}-04-0${rng.int(1, 9)}`),
        guardians: {
          create: {
            guardianId: father.id,
            relation: 'Father',
            isPrimary: true,
          },
        },
        enrollments: {
          create: {
            schoolId,
            sectionId: section.id,
            academicYearId: opts.academicYearId,
            status: EnrollmentStatus.LEFT,
          },
        },
      },
    });
    jobs.push({
      on: leavingOn,
      run: (on) =>
        issue(student.id, CertificateType.LEAVING, on, {
          conduct: rng.pick(['Excellent', 'Very good', 'Good']),
          leavingOn: on,
          reason: rng.pick(LEAVING_REASONS),
        }),
    });
  }

  // Character and enrolment certificates for children still here: visas,
  // scholarships, a parent's office allowance.
  const active = await prisma.student.findMany({
    where: { schoolId, status: StudentStatus.ACTIVE },
    select: { id: true },
    orderBy: { admissionNo: 'asc' },
  });
  const leavers = jobs.length;
  for (const s of rng
    .shuffle(active)
    .slice(0, Math.max(4, Math.round(active.length / 40)))) {
    const type = rng.chance(0.6)
      ? CertificateType.ENROLMENT
      : CertificateType.CHARACTER;
    const conduct = rng.pick(['Excellent', 'Very good', 'Good']);
    jobs.push({
      on: daysBefore(today, rng.int(1, 120)),
      run: (on) => issue(s.id, type, on, { conduct }),
    });
  }

  // Serial numbers follow the order they were issued in.
  jobs.sort((a, b) => a.on.localeCompare(b.on));
  for (const job of jobs) await job.run(job.on);
  await prisma.certificate.createMany({ data: issued });
  return { certificates: issued.length, leavers };
}
