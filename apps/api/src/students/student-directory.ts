import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { Prisma, StudentStatus } from '@prisma/client';
import { z } from 'zod';
import { attendanceRate, emptyCounts } from '../attendance/attendance-matrix.js';
import { daysBefore, dayStart, localToday } from '../common/dates.js';
import type { SubjectResult } from '../exams/result-calculator.js';
import type { PrismaService } from '../prisma/prisma.service.js';

export const FEE_STATUSES = ['PAID', 'PENDING', 'OVERDUE'] as const;
export type FeeStatus = (typeof FEE_STATUSES)[number];

/** A filter that may arrive as `a,b`, as repeated `?x=a&x=b`, or not at all. */
const multi = <T extends string>(values: readonly [T, ...T[]] | null) =>
  z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => (Array.isArray(v) ? v : (v ?? '').split(',')).map((x) => x.trim()).filter(Boolean))
    .pipe(values ? z.array(z.enum(values)) : z.array(z.string().max(64)))
    .transform((v) => [...new Set(v)] as T[]);

export const directoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(80).optional(),
  classId: multi<string>(null),
  sectionId: multi<string>(null),
  /** Empty means current (ACTIVE) students only. */
  status: multi(Object.values(StudentStatus) as [StudentStatus, ...StudentStatus[]]),
  feeStatus: multi(FEE_STATUSES),
  sort: z.enum(['name', 'admissionNo', 'attendance', 'class']).default('name'),
  dir: z.enum(['asc', 'desc']).default('asc'),
});
export type DirectoryQuery = z.infer<typeof directoryQuerySchema>;

/**
 * Fee standing from a student's open (UNPAID/PARTIAL) invoices: OVERDUE when
 * any is past its due date, PENDING when some are open but not yet due,
 * otherwise PAID. Mirrors the SQL in studentDirectory.
 */
export function feeStatusOf(openInvoices: { dueDate: string }[], today: string): FeeStatus {
  if (openInvoices.some((i) => i.dueDate < today)) return 'OVERDUE';
  return openInvoices.length ? 'PENDING' : 'PAID';
}

/** ORDER BY for the directory; every order ends in id so pages never overlap. */
export function directoryOrder(sort: DirectoryQuery['sort'], dir: DirectoryQuery['dir']): Prisma.Sql {
  const d = Prisma.raw(dir === 'desc' ? 'DESC' : 'ASC');
  const byName = (o: Prisma.Sql) => Prisma.sql`lower(b."firstName") ${o}, lower(coalesce(b."lastName", '')) ${o}`;
  // Ties on other columns fall back to A-Z by name whichever way the main column runs.
  const name = byName(Prisma.raw('ASC'));
  switch (sort) {
    case 'admissionNo':
      return Prisma.sql`b."admissionNo" ${d}, b.id`;
    case 'attendance':
      // Students with no attendance yet sort last either way.
      return Prisma.sql`b."attendanceRate" ${d} NULLS LAST, ${name}, b.id`;
    case 'class':
      return Prisma.sql`b."classSort" ${d} NULLS LAST, b."className" ${d}, b."sectionName" ${d}, ${name}, b.id`;
    default:
      return Prisma.sql`${byName(d)}, b.id`;
  }
}

interface DirectoryRow {
  id: string;
  admissionNo: string;
  firstName: string;
  lastName: string | null;
  photoUrl: string | null;
  status: StudentStatus;
  classId: string | null;
  className: string | null;
  sectionId: string | null;
  sectionName: string | null;
  attendanceRate: number | null;
  balance: number;
  feeStatus: FeeStatus;
  total: number;
}

async function currentYear(prisma: PrismaService, schoolId: string) {
  return prisma.academicYear.findFirst({
    where: { schoolId, isCurrent: true },
    select: { id: true, startsOn: true, endsOn: true },
  });
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Which other modules' data the viewer may see here. The directory and the
 * drawer are guarded by `students`; fee, exam and attendance figures are
 * left out (null / empty) when the school's permission matrix gives the
 * viewer `none` for that module. `examDrafts`: marks from unpublished exams
 * may be used when no result is published (exams manage only).
 */
export interface DirectoryAccess {
  fees: boolean;
  attendance: boolean;
  exams: boolean;
  examDrafts: boolean;
}

export const FULL_ACCESS: DirectoryAccess = {
  fees: true,
  attendance: true,
  exams: true,
  examDrafts: true,
};

/**
 * One page of the student directory with attendance rate (current academic
 * year) and fee standing worked out in a single SQL statement: attendance and
 * open invoices are aggregated per student in CTEs, then joined, filtered,
 * sorted and paged together, so sorting by attendance and filtering by fee
 * status work across the whole school, not just the page. Guardians for the
 * page come in one more query.
 */
export async function studentDirectory(
  prisma: PrismaService,
  schoolId: string,
  campuses: string[] | null,
  query: DirectoryQuery,
  access: DirectoryAccess = FULL_ACCESS,
) {
  // Hidden modules can be neither filtered nor sorted on.
  const q: DirectoryQuery = {
    ...query,
    feeStatus: access.fees ? query.feeStatus : [],
    sort: !access.attendance && query.sort === 'attendance' ? 'name' : query.sort,
  };
  const year = await currentYear(prisma, schoolId);
  const today = localToday();
  const statuses = q.status.length ? q.status : [StudentStatus.ACTIVE];

  const filters: Prisma.Sql[] = [Prisma.sql`b.status::text IN (${Prisma.join(statuses)})`];
  if (q.classId.length) filters.push(Prisma.sql`b."classId" IN (${Prisma.join(q.classId)})`);
  if (q.sectionId.length) filters.push(Prisma.sql`b."sectionId" IN (${Prisma.join(q.sectionId)})`);
  if (q.feeStatus.length) filters.push(Prisma.sql`b."feeStatus" IN (${Prisma.join(q.feeStatus)})`);
  if (q.search) {
    const like = `%${q.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    filters.push(Prisma.sql`(
      (b."firstName" || ' ' || coalesce(b."lastName", '')) ILIKE ${like}
      OR b."admissionNo" ILIKE ${like}
      OR EXISTS (
        SELECT 1 FROM "StudentGuardian" sg JOIN "Guardian" g ON g.id = sg."guardianId"
        WHERE sg."studentId" = b.id AND g.phone LIKE ${like}
      )
    )`);
  }

  // Without a current year there is no attendance window; the rate is then null.
  const attendanceWindow = year
    ? Prisma.sql`s.date >= ${iso(year.startsOn)}::date AND s.date <= ${iso(year.endsOn)}::date`
    : Prisma.sql`false`;

  const fetchPage = (limit: number, offset: number) => prisma.$queryRaw<DirectoryRow[]>`
    WITH att AS (
      SELECT r."studentId",
        count(*) AS marked,
        count(*) FILTER (WHERE r.status IN ('PRESENT', 'LATE')) AS attended
      FROM "AttendanceRecord" r
      JOIN "AttendanceSession" s ON s.id = r."sessionId"
      WHERE s."schoolId" = ${schoolId} AND ${attendanceWindow}
      GROUP BY r."studentId"
    ),
    fee AS (
      SELECT i."studentId",
        sum(greatest(i.total - i.paid, 0)) AS balance,
        bool_or(i."dueDate" < ${today}::date) AS overdue
      FROM "Invoice" i
      WHERE i."schoolId" = ${schoolId} AND i.status IN ('UNPAID', 'PARTIAL')
      GROUP BY i."studentId"
    ),
    b AS (
      SELECT st.id, st."admissionNo", st."firstName", st."lastName", st."photoUrl", st.status,
        en."classId", en."className", en."classSort", en."sectionId", en."sectionName",
        CASE WHEN att.marked > 0 THEN round(att.attended * 100.0 / att.marked, 1)::float8 END AS "attendanceRate",
        coalesce(fee.balance, 0)::int AS balance,
        CASE WHEN fee.overdue THEN 'OVERDUE' WHEN fee."studentId" IS NOT NULL THEN 'PENDING' ELSE 'PAID' END AS "feeStatus"
      FROM "Student" st
      LEFT JOIN LATERAL (
        -- The class a student is in now, or was last in if they have left.
        SELECT e."sectionId", sec.name AS "sectionName", c.id AS "classId", c.name AS "className", c."sortOrder" AS "classSort"
        FROM "Enrollment" e
        JOIN "Section" sec ON sec.id = e."sectionId"
        JOIN "Class" c ON c.id = sec."classId"
        WHERE e."studentId" = st.id
        ORDER BY (e."academicYearId" = ${year?.id ?? ''}) DESC, (e.status = 'ACTIVE') DESC, e."createdAt" DESC
        LIMIT 1
      ) en ON true
      LEFT JOIN att ON att."studentId" = st.id
      LEFT JOIN fee ON fee."studentId" = st.id
      WHERE st."schoolId" = ${schoolId}
        ${campuses ? Prisma.sql`AND st."campusId" IN (${campuses.length ? Prisma.join(campuses) : Prisma.sql`NULL`})` : Prisma.empty}
    )
    SELECT b.*, (count(*) OVER ())::int AS total
    FROM b
    WHERE ${Prisma.join(filters, ' AND ')}
    ORDER BY ${directoryOrder(q.sort, q.dir)}
    LIMIT ${limit} OFFSET ${offset}
  `;
  const rows = await fetchPage(q.pageSize, (q.page - 1) * q.pageSize);

  const ids = rows.map((r) => r.id);
  const links = ids.length
    ? await prisma.studentGuardian.findMany({
        where: { studentId: { in: ids } },
        orderBy: [{ isPrimary: 'desc' }],
        select: {
          studentId: true,
          relation: true,
          guardian: { select: { name: true, phone: true } },
        },
      })
    : [];
  const guardianOf = new Map<string, { name: string; phone: string; relation: string }>();
  for (const l of links) {
    if (!guardianOf.has(l.studentId)) guardianOf.set(l.studentId, { ...l.guardian, relation: l.relation });
  }

  // An empty page past the end still needs the total for the pager.
  const total: number = rows[0]?.total ?? (q.page > 1 ? ((await fetchPage(1, 0))[0]?.total ?? 0) : 0);

  return {
    items: rows.map((r) => ({
      id: r.id,
      admissionNo: r.admissionNo,
      name: [r.firstName, r.lastName].filter(Boolean).join(' '),
      photoUrl: r.photoUrl,
      classId: r.classId,
      className: r.className,
      sectionId: r.sectionId,
      sectionName: r.sectionName,
      attendanceRate: access.attendance ? r.attendanceRate : null,
      guardian: guardianOf.get(r.id) ?? null,
      feeStatus: access.fees ? r.feeStatus : null,
      balance: access.fees ? r.balance : null,
      status: r.status,
    })),
    total,
    page: q.page,
    pageSize: q.pageSize,
  };
}

/**
 * Percent per subject from a published result's subject list. Absent counts
 * as zero (as on the report card); a paper with no marks entered is skipped.
 */
export function percentsFromResult(subjects: SubjectResult[]): { subject: string; percent: number }[] {
  return subjects
    .filter((s) => s.max > 0 && (s.absent || s.marks !== null))
    .map((s) => ({
      subject: s.subject,
      percent: round1(((s.absent ? 0 : (s.marks ?? 0)) / s.max) * 100),
    }));
}

/**
 * Fallback when no result is published: the student's marks per subject
 * across every exam paper, as total obtained over total possible.
 */
export function percentsFromMarks(
  marks: {
    subject: string;
    marks: number | null;
    isAbsent: boolean;
    max: number;
  }[],
): { subject: string; percent: number }[] {
  const bySubject = new Map<string, { got: number; max: number }>();
  for (const m of marks) {
    if (m.max <= 0 || (!m.isAbsent && m.marks === null)) continue;
    const t = bySubject.get(m.subject) ?? { got: 0, max: 0 };
    t.got += m.isAbsent ? 0 : (m.marks ?? 0);
    t.max += m.max;
    bySubject.set(m.subject, t);
  }
  return [...bySubject]
    .map(([subject, t]) => ({
      subject,
      percent: round1((t.got / t.max) * 100),
    }))
    .sort((a, b) => a.subject.localeCompare(b.subject));
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Days covered by the attendance heatmap: 26 weeks ending today. */
export const HEATMAP_DAYS = 26 * 7;

export interface FeeInvoiceInput {
  total: number;
  paid: number;
  status: 'UNPAID' | 'PARTIAL' | 'PAID' | 'CANCELLED';
  dueDate: string;
}

/** Billed, paid and outstanding totals over a student's invoices (cancelled ones ignored). */
export function feeSummary(invoices: FeeInvoiceInput[], today: string) {
  const live = invoices.filter((i) => i.status !== 'CANCELLED');
  const open = live.filter((i) => i.status === 'UNPAID' || i.status === 'PARTIAL');
  const due = (list: FeeInvoiceInput[]) => list.reduce((s, i) => s + Math.max(0, i.total - i.paid), 0);
  return {
    totalBilled: live.reduce((s, i) => s + i.total, 0),
    totalPaid: live.reduce((s, i) => s + i.paid, 0),
    balance: due(open),
    overdueBalance: due(open.filter((i) => i.dueDate < today)),
    openInvoices: open.length,
    status: feeStatusOf(open, today),
  };
}

/** Subject scores, attendance history and fee standing for the directory drawer. */
export async function studentPerformance(
  prisma: PrismaService,
  schoolId: string,
  campuses: string[] | null,
  studentId: string,
  access: DirectoryAccess = FULL_ACCESS,
) {
  const student = await prisma.student.findFirst({
    where: { id: studentId, schoolId },
    select: { id: true, campusId: true },
  });
  if (!student) throw new NotFoundException('Student not found');
  if (campuses && !campuses.includes(student.campusId)) {
    throw new ForbiddenException('Student is at another campus');
  }
  const today = localToday();
  const heatmapFrom = daysBefore(today, HEATMAP_DAYS - 1);
  const year = await currentYear(prisma, schoolId);

  const [result, recent, yearCounts, invoices, lastPayment] = await Promise.all([
    access.exams
      ? prisma.examResult.findFirst({
          where: { studentId, exam: { status: 'PUBLISHED', schoolId } },
          orderBy: [{ exam: { publishedAt: 'desc' } }, { createdAt: 'desc' }],
          select: {
            subjects: true,
            percent: true,
            grade: true,
            exam: { select: { id: true, name: true } },
          },
        })
      : null,
    !access.attendance
      ? []
      : prisma.attendanceRecord.findMany({
          where: {
            studentId,
            session: {
              date: { gte: dayStart(heatmapFrom), lte: dayStart(today) },
            },
          },
          orderBy: { session: { date: 'asc' } },
          select: { status: true, session: { select: { date: true } } },
        }),
    year && access.attendance
      ? prisma.attendanceRecord.groupBy({
          by: ['status'],
          where: {
            studentId,
            session: { date: { gte: year.startsOn, lte: year.endsOn } },
          },
          _count: true,
        })
      : Promise.resolve([]),
    access.fees
      ? prisma.invoice.findMany({
          where: { studentId, schoolId },
          select: { total: true, paid: true, status: true, dueDate: true },
        })
      : [],
    access.fees
      ? prisma.payment.findFirst({
          where: { invoice: { studentId }, schoolId, reversedAt: null },
          orderBy: { receivedAt: 'desc' },
          select: { amount: true, receivedAt: true, receiptNo: true },
        })
      : null,
  ]);

  let subjects: { subject: string; percent: number }[];
  if (!access.exams) {
    subjects = [];
  } else if (result) {
    subjects = percentsFromResult(result.subjects as unknown as SubjectResult[]);
  } else {
    const marks = await prisma.mark.findMany({
      where: {
        studentId,
        paper: {
          exam: {
            schoolId,
            ...(year ? { academicYearId: year.id } : {}),
            // Unpublished marks only for those who manage exams.
            ...(access.examDrafts ? {} : { status: 'PUBLISHED' as const }),
          },
        },
      },
      select: {
        marks: true,
        isAbsent: true,
        paper: {
          select: { maxMarks: true, subject: { select: { name: true } } },
        },
      },
    });
    subjects = percentsFromMarks(
      marks.map((m) => ({
        subject: m.paper.subject.name,
        marks: m.marks,
        isAbsent: m.isAbsent,
        max: m.paper.maxMarks,
      })),
    );
  }

  const counts = emptyCounts();
  for (const g of yearCounts) counts[g.status] = g._count;

  return {
    examId: result?.exam.id ?? null,
    examName: result?.exam.name ?? null,
    overallPercent: result?.percent ?? null,
    grade: result?.grade ?? null,
    subjects,
    attendanceFrom: heatmapFrom,
    attendanceTo: today,
    attendanceByDay: recent.map((r) => ({
      date: iso(r.session.date),
      status: r.status,
    })),
    attendanceCounts: counts,
    attendanceRate: access.attendance ? attendanceRate(counts) : null,
    feeSummary: access.fees
      ? {
          ...feeSummary(
            invoices.map((i) => ({ ...i, dueDate: iso(i.dueDate) })),
            today,
          ),
          lastPayment: lastPayment
            ? {
                amount: lastPayment.amount,
                receivedAt: lastPayment.receivedAt.toISOString(),
                receiptNo: lastPayment.receiptNo,
              }
            : null,
        }
      : null,
  };
}
