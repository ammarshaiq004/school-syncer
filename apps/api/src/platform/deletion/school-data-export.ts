import type { Writable } from 'node:stream';
import { ZipWriter } from '../../common/zip.js';
import type { PrismaService } from '../../prisma/prisma.service.js';

const PAGE = 1000;

/** One CSV field: quoted when it holds a comma, quote or line break. */
const field = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
const line = (values: unknown[]) => `${values.map(field).join(',')}\r\n`;
const day = (d: Date | null) => d?.toISOString().slice(0, 10) ?? '';

/** Walks a table 1000 rows at a time by id, so a big school never sits in memory. */
async function* rows<T extends { id: string }>(fetch: (after: string | undefined, take: number) => Promise<T[]>) {
  let after: string | undefined;
  for (;;) {
    const page = await fetch(after, PAGE);
    yield* page;
    if (page.length < PAGE) return;
    after = page[page.length - 1].id;
  }
}
const cursor = (after?: string) => ({ cursor: after ? { id: after } : undefined, skip: after ? 1 : 0 });

async function* csv<T>(header: string[], source: AsyncIterable<T>, toRow: (row: T) => unknown[]) {
  yield line(header);
  for await (const row of source) yield line(toRow(row));
}

/**
 * Writes a zip of the school's records as CSV files: students, staff, fee
 * vouchers and payments, exam marks and attendance. Everything is read for
 * this school only. Returns how many data rows were written.
 */
export async function writeSchoolExport(prisma: PrismaService, schoolId: string, out: Writable): Promise<number> {
  const zip = new ZipWriter(out);
  let total = 0;
  const counted = async function* <T>(source: AsyncIterable<T>) {
    for await (const row of source) {
      total += 1;
      yield row;
    }
  };
  const where = { schoolId };

  await zip.addFile(
    'students.csv',
    csv(
      ['admission_no', 'first_name', 'last_name', 'gender', 'date_of_birth', 'b_form_no', 'address', 'status', 'admitted_on', 'campus'],
      counted(rows((after, take) => prisma.student.findMany({ where, orderBy: { id: 'asc' }, take, ...cursor(after), include: { campus: { select: { name: true } } } }))),
      (s) => [s.admissionNo, s.firstName, s.lastName, s.gender, day(s.dateOfBirth), s.bFormNo, s.address, s.status, day(s.admittedOn), s.campus.name],
    ),
  );

  await zip.addFile(
    'staff.csv',
    csv(
      ['name', 'email', 'phone', 'roles', 'active', 'last_sign_in'],
      counted(rows((after, take) => prisma.user.findMany({ where: { ...where, roles: { some: { role: { notIn: ['PARENT', 'STUDENT'] } } } }, orderBy: { id: 'asc' }, take, ...cursor(after), include: { roles: { select: { role: true } } } }))),
      (u) => [u.name, u.email, u.phone, [...new Set(u.roles.map((r) => r.role))].join(' '), u.isActive, u.lastLoginAt],
    ),
  );

  await zip.addFile(
    'fee-vouchers.csv',
    csv(
      ['voucher_no', 'admission_no', 'period', 'kind', 'issue_date', 'due_date', 'total', 'paid', 'status'],
      counted(rows((after, take) => prisma.invoice.findMany({ where, orderBy: { id: 'asc' }, take, ...cursor(after), include: { student: { select: { admissionNo: true } } } }))),
      (i) => [i.voucherNo, i.student.admissionNo, i.period, i.kind, day(i.issueDate), day(i.dueDate), i.total, i.paid, i.status],
    ),
  );

  await zip.addFile(
    'fee-payments.csv',
    csv(
      ['receipt_no', 'voucher_no', 'amount', 'method', 'reference', 'received_at', 'reversed_at'],
      counted(rows((after, take) => prisma.payment.findMany({ where, orderBy: { id: 'asc' }, take, ...cursor(after), include: { invoice: { select: { voucherNo: true } } } }))),
      (p) => [p.receiptNo, p.invoice.voucherNo, p.amount, p.method, p.reference, p.receivedAt, p.reversedAt],
    ),
  );

  await zip.addFile(
    'exam-marks.csv',
    csv(
      ['exam', 'class', 'subject', 'admission_no', 'marks', 'absent', 'max_marks'],
      counted(
        rows((after, take) =>
          prisma.mark.findMany({
            where: { paper: { exam: where } },
            orderBy: { id: 'asc' },
            take,
            ...cursor(after),
            include: { student: { select: { admissionNo: true } }, paper: { include: { exam: { select: { name: true } }, class: { select: { name: true } }, subject: { select: { name: true } } } } },
          }),
        ),
      ),
      (m) => [m.paper.exam.name, m.paper.class.name, m.paper.subject.name, m.student.admissionNo, m.marks, m.isAbsent, m.paper.maxMarks],
    ),
  );

  await zip.addFile(
    'attendance.csv',
    csv(
      ['date', 'class', 'section', 'admission_no', 'status'],
      counted(
        rows((after, take) =>
          prisma.attendanceRecord.findMany({
            where: { session: where },
            orderBy: { id: 'asc' },
            take,
            ...cursor(after),
            include: { student: { select: { admissionNo: true } }, session: { include: { section: { select: { name: true, class: { select: { name: true } } } } } } },
          }),
        ),
      ),
      (a) => [day(a.session.date), a.session.section.class.name, a.session.section.name, a.student.admissionNo, a.status],
    ),
  );

  await zip.finish();
  return total;
}
