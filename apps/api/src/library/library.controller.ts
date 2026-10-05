import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  CopyStatus,
  FineStatus,
  Prisma,
  Role,
  StudentStatus,
} from '@prisma/client';
import { z } from 'zod';
import {
  campusScope,
  SETUP_ROLES,
  STAFF_ROLES,
} from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { dayStart, localToday } from '../common/dates.js';
import { CurrentUser, Permission, RequiresFeature, Roles } from '../common/decorators.js';
import { studentSearchWhere } from '../common/student-search.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { dueDate, lateFine, nextAccessionNumbers } from './library-rules.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const text = (max: number) => z.string().trim().max(max).nullable().optional();

const bookSchema = z.object({
  title: z.string().trim().min(1).max(200),
  author: text(120),
  isbn: text(20),
  publisher: text(120),
  category: text(60),
  language: z.string().trim().min(2).max(30).default('English'),
  shelf: text(20),
});

const newBookSchema = bookSchema.extend({
  copies: z.number().int().min(1).max(200).default(1),
  campusId: z.string().nullable().optional(),
});

const issueSchema = z
  .object({
    accessionNo: z.string().trim().min(1),
    studentId: z.string().optional(),
    userId: z.string().optional(),
    dueOn: isoDate.optional(),
  })
  .refine(
    (b) => Boolean(b.studentId) !== Boolean(b.userId),
    'Choose one student or one member of staff',
  );

const settingsSchema = z.object({
  libraryLoanDays: z.number().int().min(1).max(120).optional(),
  libraryFinePerDay: z.number().int().min(0).max(1000).optional(),
  libraryMaxLoans: z.number().int().min(1).max(20).optional(),
});

const iso = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;
const name = (s: { firstName: string; lastName: string | null }) =>
  [s.firstName, s.lastName].filter(Boolean).join(' ');

const loanInclude = {
  copy: {
    select: {
      accessionNo: true,
      book: { select: { id: true, title: true, author: true } },
    },
  },
  student: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      admissionNo: true,
      enrollments: {
        where: { status: 'ACTIVE' as const },
        select: {
          section: {
            select: { name: true, class: { select: { name: true } } },
          },
        },
      },
    },
  },
  user: { select: { id: true, name: true } },
} satisfies Prisma.BookLoanInclude;

type LoanRow = Prisma.BookLoanGetPayload<{ include: typeof loanInclude }>;

/** The school library: the catalogue, the issue desk, overdue books and fines. */
@Controller('library')
@Permission('library')
@RequiresFeature('library')
@Roles(...STAFF_ROLES)
export class LibraryController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('summary')
  async summary(@CurrentUser() user: AuthUser) {
    const today = dayStart(localToday());
    const schoolId = user.schoolId;
    const [titles, copies, onLoan, overdue, fines, settings] =
      await Promise.all([
        this.prisma.book.count({ where: { schoolId } }),
        this.prisma.bookCopy.groupBy({
          by: ['status'],
          where: { schoolId },
          _count: true,
        }),
        this.prisma.bookLoan.count({ where: { schoolId, returnedOn: null } }),
        this.prisma.bookLoan.count({
          where: { schoolId, returnedOn: null, dueOn: { lt: today } },
        }),
        this.prisma.bookLoan.aggregate({
          where: { schoolId, fineStatus: FineStatus.DUE },
          _sum: { fine: true },
          _count: true,
        }),
        this.settings(schoolId),
      ]);
    return {
      titles,
      copies: Object.fromEntries(copies.map((c) => [c.status, c._count])),
      onLoan,
      overdue,
      finesDue: { amount: fines._sum.fine ?? 0, count: fines._count },
      settings,
    };
  }

  // ----- Settings -----

  @Get('settings')
  getSettings(@CurrentUser() user: AuthUser) {
    return this.settings(user.schoolId);
  }

  @Patch('settings')
  @Roles(...SETUP_ROLES)
  async updateSettings(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(settingsSchema))
    body: z.infer<typeof settingsSchema>,
  ) {
    const before = await this.settings(user.schoolId);
    await this.prisma.school.update({
      where: { id: user.schoolId },
      data: body,
    });
    await this.audit.record(user, 'library.settings', 'School', user.schoolId, {
      before,
      after: body,
    });
    return this.settings(user.schoolId);
  }

  // ----- Catalogue -----

  @Get('books')
  async books(
    @CurrentUser() user: AuthUser,
    @Query('search') search?: string,
    @Query('category') category?: string,
  ) {
    const q = search?.trim();
    const books = await this.prisma.book.findMany({
      where: {
        schoolId: user.schoolId,
        ...(category ? { category } : {}),
        ...(q
          ? {
              OR: [
                { title: { contains: q, mode: 'insensitive' } },
                { author: { contains: q, mode: 'insensitive' } },
                { isbn: { contains: q } },
                { copies: { some: { accessionNo: q } } },
              ],
            }
          : {}),
      },
      orderBy: { title: 'asc' },
      take: 300,
      include: { copies: { select: { status: true } } },
    });
    return books.map(({ copies, ...b }) => ({
      ...b,
      copies: copies.filter((c) => c.status !== CopyStatus.WITHDRAWN).length,
      available: copies.filter((c) => c.status === CopyStatus.AVAILABLE).length,
    }));
  }

  @Get('categories')
  async categories(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.book.groupBy({
      by: ['category'],
      where: { schoolId: user.schoolId, category: { not: null } },
      _count: true,
      orderBy: { category: 'asc' },
    });
    return rows.map((r) => ({ category: r.category, titles: r._count }));
  }

  /** Adds a title with its copies, numbering them after the highest accession number. */
  @Post('books')
  async addBook(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(newBookSchema))
    body: z.infer<typeof newBookSchema>,
  ) {
    const { copies, campusId, ...book } = body;
    await this.checkCampus(user, campusId);
    const created = await this.prisma.$transaction(async (tx) => {
      const b = await tx.book.create({
        data: { ...book, schoolId: user.schoolId },
      });
      await this.createCopies(
        tx,
        user.schoolId,
        b.id,
        copies,
        campusId ?? null,
      );
      return b;
    });
    await this.audit.record(user, 'library.book.create', 'Book', created.id, {
      after: body,
    });
    return this.book(user, created.id);
  }

  @Get('books/:id')
  async book(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const book = await this.prisma.book.findFirst({
      where: { id, schoolId: user.schoolId },
      include: {
        copies: {
          orderBy: { accessionNo: 'asc' },
          include: {
            campus: { select: { name: true } },
            loans: { where: { returnedOn: null }, include: loanInclude },
          },
        },
      },
    });
    if (!book) throw new NotFoundException('Book not found');
    const history = await this.prisma.bookLoan.count({
      where: { copy: { bookId: id } },
    });
    return {
      ...book,
      timesBorrowed: history,
      copies: book.copies.map(({ loans, ...c }) => ({
        ...c,
        loan: loans[0] ? this.loanView(loans[0]) : null,
      })),
    };
  }

  @Patch('books/:id')
  async updateBook(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(bookSchema.partial()))
    body: Partial<z.infer<typeof bookSchema>>,
  ) {
    const before = await this.prisma.book.findFirst({
      where: { id, schoolId: user.schoolId },
    });
    if (!before) throw new NotFoundException('Book not found');
    const after = await this.prisma.book.update({ where: { id }, data: body });
    await this.audit.record(user, 'library.book.update', 'Book', id, {
      before,
      after,
    });
    return after;
  }

  @Post('books/:id/copies')
  async addCopies(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(
      new ZodValidationPipe(
        z.object({
          count: z.number().int().min(1).max(200),
          campusId: z.string().nullable().optional(),
        }),
      ),
    )
    body: { count: number; campusId?: string | null },
  ) {
    const book = await this.prisma.book.findFirst({
      where: { id, schoolId: user.schoolId },
    });
    if (!book) throw new NotFoundException('Book not found');
    await this.checkCampus(user, body.campusId);
    const numbers = await this.prisma.$transaction((tx) =>
      this.createCopies(
        tx,
        user.schoolId,
        id,
        body.count,
        body.campusId ?? null,
      ),
    );
    await this.audit.record(user, 'library.copies.add', 'Book', id, {
      after: { accessionNos: numbers },
    });
    return { accessionNos: numbers };
  }

  /** Takes a damaged copy off the shelf, or puts a found one back. */
  @Patch('copies/:id')
  async updateCopy(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(
      new ZodValidationPipe(
        z.object({
          status: z.enum([CopyStatus.AVAILABLE, CopyStatus.WITHDRAWN]),
        }),
      ),
    )
    body: { status: 'AVAILABLE' | 'WITHDRAWN' },
  ) {
    const copy = await this.prisma.bookCopy.findFirst({
      where: { id, schoolId: user.schoolId },
    });
    if (!copy) throw new NotFoundException('Copy not found');
    if (copy.status === CopyStatus.ON_LOAN)
      throw new ConflictException('This copy is on loan; take it back first');
    const after = await this.prisma.bookCopy.update({
      where: { id },
      data: { status: body.status },
    });
    await this.audit.record(user, 'library.copy.status', 'BookCopy', id, {
      before: copy.status,
      after: body.status,
    });
    return after;
  }

  // ----- The desk -----

  /** Looks up a copy by the number inside it: what it is and who has it. */
  @Get('copies/:accessionNo')
  async copy(
    @CurrentUser() user: AuthUser,
    @Param('accessionNo') accessionNo: string,
  ) {
    const copy = await this.prisma.bookCopy.findUnique({
      where: {
        schoolId_accessionNo: {
          schoolId: user.schoolId,
          accessionNo: accessionNo.trim(),
        },
      },
      include: {
        book: true,
        loans: { where: { returnedOn: null }, include: loanInclude },
      },
    });
    if (!copy) throw new NotFoundException(`No book numbered ${accessionNo}`);
    const { loans, ...rest } = copy;
    return { ...rest, loan: loans[0] ? this.loanView(loans[0]) : null };
  }

  /** Students and staff to lend to, by name or admission number. */
  @Get('borrowers')
  async borrowers(@CurrentUser() user: AuthUser, @Query('search') search = '') {
    const q = search.trim();
    if (q.length < 2) return [];
    const scope = campusScope(user);
    const [students, staff] = await Promise.all([
      this.prisma.student.findMany({
        where: {
          schoolId: user.schoolId,
          status: StudentStatus.ACTIVE,
          ...(scope ? { campusId: { in: scope } } : {}),
          ...studentSearchWhere(q),
        },
        take: 15,
        orderBy: { firstName: 'asc' },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          admissionNo: true,
          enrollments: loanInclude.student.select.enrollments,
        },
      }),
      this.prisma.user.findMany({
        where: {
          schoolId: user.schoolId,
          isActive: true,
          name: { contains: q, mode: 'insensitive' },
          roles: { some: { role: { in: STAFF_ROLES } } },
        },
        take: 10,
        select: { id: true, name: true },
      }),
    ]);
    const ids = [...students.map((s) => s.id), ...staff.map((s) => s.id)];
    const out = await this.prisma.bookLoan.groupBy({
      by: ['studentId', 'userId'],
      where: {
        schoolId: user.schoolId,
        returnedOn: null,
        OR: [{ studentId: { in: ids } }, { userId: { in: ids } }],
      },
      _count: true,
    });
    const count = (id: string) =>
      out.find((o) => o.studentId === id || o.userId === id)?._count ?? 0;
    return [
      ...students.map((s) => ({
        kind: 'student' as const,
        id: s.id,
        name: name(s),
        detail: [
          s.admissionNo,
          s.enrollments[0] &&
            `${s.enrollments[0].section.class.name} ${s.enrollments[0].section.name}`,
        ]
          .filter(Boolean)
          .join(' · '),
        onLoan: count(s.id),
      })),
      ...staff.map((s) => ({
        kind: 'staff' as const,
        id: s.id,
        name: s.name,
        detail: 'Staff',
        onLoan: count(s.id),
      })),
    ];
  }

  /**
   * Lends a copy. Students may hold the school's limit of books at once and
   * can't borrow while one is overdue; staff have no limit.
   */
  @Post('loans')
  async issue(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(issueSchema)) body: z.infer<typeof issueSchema>,
  ) {
    const settings = await this.settings(user.schoolId);
    const today = localToday();
    const copy = await this.prisma.bookCopy.findUnique({
      where: {
        schoolId_accessionNo: {
          schoolId: user.schoolId,
          accessionNo: body.accessionNo,
        },
      },
      include: { book: true },
    });
    if (!copy)
      throw new NotFoundException(`No book numbered ${body.accessionNo}`);
    if (copy.status !== CopyStatus.AVAILABLE) {
      throw new ConflictException(
        `${copy.book.title} (${copy.accessionNo}) is ${copy.status === CopyStatus.ON_LOAN ? 'already on loan' : copy.status.toLowerCase()}`,
      );
    }

    let borrower: string;
    if (body.studentId) {
      const student = await this.prisma.student.findFirst({
        where: { id: body.studentId, schoolId: user.schoolId },
      });
      if (!student || student.status !== StudentStatus.ACTIVE)
        throw new NotFoundException('Student not found');
      const scope = campusScope(user);
      if (scope && !scope.includes(student.campusId))
        throw new ForbiddenException('Student is at another campus');
      borrower = name(student);
      const open = await this.prisma.bookLoan.findMany({
        where: { studentId: student.id, returnedOn: null },
        include: { copy: { include: { book: true } } },
      });
      const late = open.find((l) => iso(l.dueOn)! < today);
      if (late)
        throw new ConflictException(
          `${borrower} has an overdue book: ${late.copy.book.title}. Take it back first.`,
        );
      if (open.length >= settings.libraryMaxLoans) {
        throw new ConflictException(
          `${borrower} already has ${open.length} books; the limit is ${settings.libraryMaxLoans}.`,
        );
      }
    } else {
      const staff = await this.prisma.user.findFirst({
        where: { id: body.userId, schoolId: user.schoolId, isActive: true },
      });
      if (!staff) throw new NotFoundException('Staff member not found');
      borrower = staff.name;
    }

    const dueOn = body.dueOn ?? dueDate(today, settings.libraryLoanDays);
    if (dueOn < today) throw new BadRequestException('The due date has passed');
    const loan = await this.prisma.$transaction(async (tx) => {
      // Guards against two desks lending the same copy at once.
      const taken = await tx.bookCopy.updateMany({
        where: { id: copy.id, status: CopyStatus.AVAILABLE },
        data: { status: CopyStatus.ON_LOAN },
      });
      if (!taken.count)
        throw new ConflictException(
          `${copy.book.title} (${copy.accessionNo}) was just lent out`,
        );
      return tx.bookLoan.create({
        data: {
          schoolId: user.schoolId,
          copyId: copy.id,
          studentId: body.studentId ?? null,
          userId: body.userId ?? null,
          issuedOn: dayStart(today),
          dueOn: dayStart(dueOn),
          issuedById: user.sub,
        },
        include: loanInclude,
      });
    });
    await this.audit.record(user, 'library.issue', 'BookLoan', loan.id, {
      after: { accessionNo: copy.accessionNo, borrower, dueOn },
    });
    return this.loanView(loan);
  }

  /** Takes a book back, charging the late fine if there is one. */
  @Post('loans/:id/return')
  async giveBack(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const loan = await this.openLoan(user, id);
    const settings = await this.settings(user.schoolId);
    const today = localToday();
    const fine = lateFine(iso(loan.dueOn)!, today, settings.libraryFinePerDay);
    const after = await this.prisma.$transaction(async (tx) => {
      await tx.bookCopy.update({
        where: { id: loan.copyId },
        data: { status: CopyStatus.AVAILABLE },
      });
      return tx.bookLoan.update({
        where: { id },
        data: {
          returnedOn: dayStart(today),
          fine,
          fineStatus: fine ? FineStatus.DUE : FineStatus.NONE,
        },
        include: loanInclude,
      });
    });
    await this.audit.record(user, 'library.return', 'BookLoan', id, {
      after: { fine },
    });
    return this.loanView(after);
  }

  /** Records a lost book: the copy leaves the catalogue and the borrower owes its cost plus any late fine. */
  @Post('loans/:id/lost')
  async lost(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(
      new ZodValidationPipe(
        z.object({ charge: z.number().int().min(0).max(100_000) }),
      ),
    )
    body: { charge: number },
  ) {
    const loan = await this.openLoan(user, id);
    const settings = await this.settings(user.schoolId);
    const today = localToday();
    const fine =
      body.charge +
      lateFine(iso(loan.dueOn)!, today, settings.libraryFinePerDay);
    const after = await this.prisma.$transaction(async (tx) => {
      await tx.bookCopy.update({
        where: { id: loan.copyId },
        data: { status: CopyStatus.LOST },
      });
      return tx.bookLoan.update({
        where: { id },
        data: {
          returnedOn: dayStart(today),
          lost: true,
          fine,
          fineStatus: fine ? FineStatus.DUE : FineStatus.NONE,
        },
        include: loanInclude,
      });
    });
    await this.audit.record(user, 'library.lost', 'BookLoan', id, {
      after: { fine },
    });
    return this.loanView(after);
  }

  /** Settles a fine at the desk, or (for school admins) lets it off. Unsettled student fines go on the next fee voucher. */
  @Post('loans/:id/fine')
  async settleFine(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(
      new ZodValidationPipe(z.object({ action: z.enum(['paid', 'waive']) })),
    )
    body: { action: 'paid' | 'waive' },
  ) {
    const loan = await this.prisma.bookLoan.findFirst({
      where: { id, schoolId: user.schoolId },
    });
    if (!loan) throw new NotFoundException('Loan not found');
    if (loan.fineStatus !== FineStatus.DUE)
      throw new ConflictException('There is no fine to settle on this book');
    if (
      body.action === 'waive' &&
      !user.roles.some(
        (r) => SETUP_ROLES.includes(r.role) || r.role === Role.ACCOUNTANT,
      )
    ) {
      throw new ForbiddenException('Only the school office can let a fine off');
    }
    const after = await this.prisma.bookLoan.update({
      where: { id },
      data: {
        fineStatus:
          body.action === 'paid' ? FineStatus.PAID : FineStatus.WAIVED,
      },
      include: loanInclude,
    });
    await this.audit.record(
      user,
      `library.fine.${body.action}`,
      'BookLoan',
      id,
      { after: { fine: loan.fine } },
    );
    return this.loanView(after);
  }

  /** Books out now, overdue ones, or unpaid fines. */
  @Get('loans')
  async loans(
    @CurrentUser() user: AuthUser,
    @Query('status') status: 'out' | 'overdue' | 'fines' | 'recent' = 'out',
  ) {
    const today = dayStart(localToday());
    const where: Prisma.BookLoanWhereInput = {
      schoolId: user.schoolId,
      ...(status === 'out' ? { returnedOn: null } : {}),
      ...(status === 'overdue'
        ? { returnedOn: null, dueOn: { lt: today } }
        : {}),
      ...(status === 'fines' ? { fineStatus: FineStatus.DUE } : {}),
      ...(status === 'recent' ? { returnedOn: { not: null } } : {}),
    };
    const rows = await this.prisma.bookLoan.findMany({
      where,
      include: loanInclude,
      orderBy: status === 'recent' ? { returnedOn: 'desc' } : { dueOn: 'asc' },
      take: 500,
    });
    return rows.map((l) => this.loanView(l));
  }

  /** A student's books: what they have now and what they've read. */
  @Get('students/:id')
  async student(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const student = await this.prisma.student.findFirst({
      where: { id, schoolId: user.schoolId },
    });
    if (!student) throw new NotFoundException('Student not found');
    const scope = campusScope(user);
    if (scope && !scope.includes(student.campusId))
      throw new ForbiddenException('Student is at another campus');
    const rows = await this.prisma.bookLoan.findMany({
      where: { studentId: id },
      include: loanInclude,
      orderBy: { issuedOn: 'desc' },
      take: 100,
    });
    return rows.map((l) => this.loanView(l));
  }

  // ----- Helpers -----

  private loanView(l: LoanRow) {
    const today = localToday();
    const dueOn = iso(l.dueOn)!;
    const e = l.student?.enrollments[0];
    return {
      id: l.id,
      accessionNo: l.copy.accessionNo,
      bookId: l.copy.book.id,
      title: l.copy.book.title,
      author: l.copy.book.author,
      borrower: l.student
        ? {
            kind: 'student' as const,
            id: l.student.id,
            name: name(l.student),
            detail: [
              l.student.admissionNo,
              e && `${e.section.class.name} ${e.section.name}`,
            ]
              .filter(Boolean)
              .join(' · '),
          }
        : {
            kind: 'staff' as const,
            id: l.user?.id ?? '',
            name: l.user?.name ?? 'Staff',
            detail: 'Staff',
          },
      issuedOn: iso(l.issuedOn),
      dueOn,
      returnedOn: iso(l.returnedOn),
      lost: l.lost,
      overdue: !l.returnedOn && dueOn < today,
      // A book still out shows what it would cost if returned today.
      fine: l.returnedOn ? l.fine : null,
      fineStatus: l.fineStatus,
    };
  }

  private async openLoan(user: AuthUser, id: string) {
    const loan = await this.prisma.bookLoan.findFirst({
      where: { id, schoolId: user.schoolId, returnedOn: null },
    });
    if (!loan) throw new NotFoundException('This book is not on loan');
    return loan;
  }

  private async settings(schoolId: string) {
    return this.prisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: {
        libraryLoanDays: true,
        libraryFinePerDay: true,
        libraryMaxLoans: true,
      },
    });
  }

  private async checkCampus(user: AuthUser, campusId?: string | null) {
    if (!campusId) return;
    const campus = await this.prisma.campus.findFirst({
      where: { id: campusId, schoolId: user.schoolId },
    });
    if (!campus) throw new BadRequestException('No such campus');
  }

  private async createCopies(
    tx: Prisma.TransactionClient,
    schoolId: string,
    bookId: string,
    count: number,
    campusId: string | null,
  ) {
    const existing = await tx.bookCopy.findMany({
      where: { schoolId },
      select: { accessionNo: true },
    });
    const numbers = nextAccessionNumbers(
      existing.map((c) => c.accessionNo),
      count,
    );
    await tx.bookCopy.createMany({
      data: numbers.map((accessionNo) => ({
        schoolId,
        bookId,
        accessionNo,
        campusId,
      })),
    });
    return numbers;
  }
}
