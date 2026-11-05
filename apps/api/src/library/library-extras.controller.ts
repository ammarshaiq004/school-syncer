import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { CopyStatus, ReservationStatus, StudentStatus } from '@prisma/client';
import { z } from 'zod';
import { campusScope, inScope, STAFF_ROLES } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { dayStart, localToday } from '../common/dates.js';
import { CurrentUser, Permission, RequiresFeature, Roles } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { bookRowSchema, checkBookRows, isbnKey, titleKey } from './book-import.js';
import { code128 } from './barcode.js';
import { settleHolds } from './library-holds.js';
import { nextAccessionNumbers } from './library-rules.js';

const reserveSchema = z
  .object({ bookId: z.string(), studentId: z.string().optional(), userId: z.string().optional() })
  .refine((b) => Boolean(b.studentId) !== Boolean(b.userId), 'Choose one student or one member of staff');

const importSchema = z.object({
  rows: z.array(bookRowSchema).min(1).max(2000),
  /** Where the new copies are shelved; campus staff must name their campus. */
  campusId: z.string().nullable().optional(),
  commit: z.boolean().optional(),
  confirmWarnings: z.boolean().optional(),
});

const personName = (s: { firstName: string; lastName: string | null }) => [s.firstName, s.lastName].filter(Boolean).join(' ');
const iso = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

/** Library reservations, barcode labels and the Excel book import. */
@Controller('library')
@Permission('library')
@RequiresFeature('library')
@Roles(...STAFF_ROLES)
export class LibraryExtrasController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ----- Reservations -----

  /** Open reservations (waiting or held at the desk), or everything with ?status=all. */
  @Get('reservations')
  async reservations(@CurrentUser() user: AuthUser, @Query('status') status = 'open') {
    const today = localToday();
    // Holds that ran out are released before anyone looks at the list.
    const books = await this.prisma.bookReservation.findMany({
      where: { schoolId: user.schoolId, status: ReservationStatus.READY, holdUntil: { lt: dayStart(today) } },
      select: { bookId: true },
      distinct: ['bookId'],
    });
    for (const b of books) await this.prisma.$transaction((tx) => settleHolds(tx, b.bookId, today));
    const rows = await this.prisma.bookReservation.findMany({
      where: {
        schoolId: user.schoolId,
        ...(status === 'all' ? {} : { status: { in: [ReservationStatus.WAITING, ReservationStatus.READY] } }),
      },
      orderBy: { createdAt: 'asc' },
      take: 500,
      include: {
        book: { select: { id: true, title: true, author: true } },
        student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } },
        user: { select: { id: true, name: true } },
      },
    });
    const copies = await this.prisma.bookCopy.findMany({ where: { id: { in: rows.flatMap((r) => (r.copyId ? [r.copyId] : [])) } }, select: { id: true, accessionNo: true } });
    const accession = new Map(copies.map((c) => [c.id, c.accessionNo]));
    const place = new Map<string, number>();
    return rows.map((r) => {
      const position = r.status === ReservationStatus.WAITING ? (place.set(r.bookId, (place.get(r.bookId) ?? 0) + 1), place.get(r.bookId)!) : null;
      return {
        id: r.id,
        status: r.status,
        book: r.book,
        borrower: r.student
          ? { kind: 'student' as const, id: r.student.id, name: personName(r.student), detail: r.student.admissionNo }
          : { kind: 'staff' as const, id: r.user!.id, name: r.user!.name, detail: 'Staff' },
        position,
        accessionNo: r.copyId ? (accession.get(r.copyId) ?? null) : null,
        holdUntil: iso(r.holdUntil),
        createdAt: r.createdAt,
      };
    });
  }

  /** Joins the queue for a title whose copies are all out. */
  @Post('reservations')
  async reserve(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(reserveSchema)) body: z.infer<typeof reserveSchema>) {
    const today = localToday();
    const book = await this.prisma.book.findFirst({ where: { id: body.bookId, schoolId: user.schoolId }, include: { copies: { select: { status: true } } } });
    if (!book) throw new NotFoundException('Book not found');
    if (body.studentId) {
      const student = await this.prisma.student.findFirst({ where: { id: body.studentId, schoolId: user.schoolId } });
      if (!student || student.status !== StudentStatus.ACTIVE) throw new NotFoundException('Student not found');
      const scope = campusScope(user);
      if (scope && !scope.includes(student.campusId)) throw new ForbiddenException('Student is at another campus');
    } else if (!(await this.prisma.user.findFirst({ where: { id: body.userId, schoolId: user.schoolId, isActive: true } }))) {
      throw new NotFoundException('Staff member not found');
    }
    const who = body.studentId ? { studentId: body.studentId } : { userId: body.userId };
    if (await this.prisma.bookReservation.findFirst({ where: { bookId: book.id, status: { in: ['WAITING', 'READY'] }, ...who } })) {
      throw new ConflictException('Already reserved by this borrower');
    }
    if (await this.prisma.bookLoan.findFirst({ where: { returnedOn: null, copy: { bookId: book.id }, ...who } })) {
      throw new ConflictException('This borrower already has a copy of the book');
    }
    const reservation = await this.prisma.$transaction(async (tx) => {
      await settleHolds(tx, book.id, today);
      if (!book.copies.some((c) => c.status === CopyStatus.AVAILABLE || c.status === CopyStatus.ON_LOAN)) {
        throw new ConflictException('The school has no usable copy of this book');
      }
      const free = await tx.bookCopy.count({
        where: { bookId: book.id, status: CopyStatus.AVAILABLE, NOT: { id: { in: (await tx.bookReservation.findMany({ where: { bookId: book.id, status: 'READY' }, select: { copyId: true } })).map((r) => r.copyId!) } } },
      });
      if (free) throw new ConflictException('A copy is on the shelf; issue it at the desk instead');
      return tx.bookReservation.create({ data: { schoolId: user.schoolId, bookId: book.id, createdById: user.sub, ...who } });
    });
    await this.audit.record(user, 'library.reserve', 'BookReservation', reservation.id, { after: { bookId: book.id, ...who } });
    return reservation;
  }

  @Post('reservations/:id/cancel')
  async cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const r = await this.prisma.bookReservation.findFirst({ where: { id, schoolId: user.schoolId, status: { in: ['WAITING', 'READY'] } } });
    if (!r) throw new NotFoundException('Reservation not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.bookReservation.update({ where: { id }, data: { status: 'CANCELLED', copyId: null, settledAt: new Date() } });
      // A held copy goes to the next person waiting.
      await settleHolds(tx, r.bookId, localToday());
    });
    await this.audit.record(user, 'library.reserve.cancel', 'BookReservation', id);
    return { id, status: 'CANCELLED' };
  }

  // ----- Barcode labels -----

  /**
   * Copies with their Code 128 barcodes (the accession number) for printing
   * labels: one title, a range of accession numbers, or a search.
   */
  @Get('labels')
  async labels(@CurrentUser() user: AuthUser, @Query('bookId') bookId?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('search') search?: string) {
    const scope = campusScope(user);
    const q = search?.trim();
    const copies = await this.prisma.bookCopy.findMany({
      where: {
        schoolId: user.schoolId,
        status: { not: CopyStatus.WITHDRAWN },
        ...(scope ? { campusId: { in: scope } } : {}),
        ...(bookId ? { bookId } : {}),
        ...(q ? { book: { OR: [{ title: { contains: q, mode: 'insensitive' } }, { author: { contains: q, mode: 'insensitive' } }] } } : {}),
      },
      include: { book: { select: { title: true, author: true, shelf: true } } },
      take: 5000,
    });
    // Accession numbers are text ("12", "REF-3"): range by the numeric ones, in number order.
    const lo = from ? Number(from) : null;
    const hi = to ? Number(to) : null;
    const picked = copies
      .filter((c) => {
        if (lo === null && hi === null) return true;
        if (!/^\d+$/.test(c.accessionNo)) return false;
        const n = Number(c.accessionNo);
        return (lo === null || n >= lo) && (hi === null || n <= hi);
      })
      .sort((a, b) => a.accessionNo.localeCompare(b.accessionNo, undefined, { numeric: true }))
      .slice(0, 500);
    return picked.map((c) => ({
      id: c.id,
      accessionNo: c.accessionNo,
      title: c.book.title,
      author: c.book.author,
      shelf: c.book.shelf,
      modules: code128(c.accessionNo),
    }));
  }

  // ----- Excel import -----

  /**
   * Adds books from a spreadsheet. Without `commit` it only checks the rows;
   * a title already in the catalogue (same ISBN, or same title and author)
   * gets the row's copies instead of a second entry.
   */
  @Post('books/import')
  async importBooks(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(importSchema)) body: z.infer<typeof importSchema>) {
    const scope = campusScope(user);
    if (!inScope(scope, body.campusId ?? null)) throw new ForbiddenException(body.campusId ? 'That campus is not yours to manage' : 'Choose your campus for these copies');
    if (body.campusId && !(await this.prisma.campus.findFirst({ where: { id: body.campusId, schoolId: user.schoolId } }))) throw new BadRequestException('No such campus');

    const catalogue = await this.prisma.book.findMany({ where: { schoolId: user.schoolId }, select: { id: true, title: true, author: true, isbn: true } });
    const byIsbn = new Map(catalogue.filter((b) => b.isbn).map((b) => [isbnKey(b.isbn!), b.id]));
    const byTitle = new Map(catalogue.map((b) => [titleKey(b.title, b.author ?? ''), b.id]));
    const rows = checkBookRows(body.rows, { isbns: new Set(byIsbn.keys()), titles: new Set(byTitle.keys()) });
    const invalid = rows.filter((r) => r.errors.length).length;
    const warned = rows.filter((r) => r.warnings.length).length;
    const summary = {
      valid: rows.length - invalid,
      invalid,
      warned,
      rows: rows.map(({ row, title, errors, warnings }) => ({ row, title, errors, warnings })),
    };
    if (!body.commit || invalid) return { ...summary, imported: 0, copies: 0 };
    if (warned && !body.confirmWarnings) return { ...summary, imported: 0, copies: 0, needsConfirmation: true };

    const today = localToday();
    const added = await this.prisma.$transaction(
      async (tx) => {
        const taken = await tx.bookCopy.findMany({ where: { schoolId: user.schoolId }, select: { accessionNo: true } });
        const total = rows.reduce((n, r) => n + r.book!.copies, 0);
        const numbers = nextAccessionNumbers(taken.map((c) => c.accessionNo), total);
        let next = 0;
        const touched = new Set<string>();
        // Rows of the same new title in one file share one catalogue entry.
        const created = new Map<string, string>();
        for (const { book } of rows) {
          const { copies, ...fields } = book!;
          const key = fields.isbn ? `isbn:${fields.isbn}` : `title:${titleKey(fields.title, fields.author ?? '')}`;
          let bookId = (fields.isbn ? byIsbn.get(fields.isbn) : undefined) ?? byTitle.get(titleKey(fields.title, fields.author ?? '')) ?? created.get(key);
          if (!bookId) {
            bookId = (await tx.book.create({ data: { ...fields, schoolId: user.schoolId }, select: { id: true } })).id;
            created.set(key, bookId);
          }
          touched.add(bookId);
          await tx.bookCopy.createMany({
            data: numbers.slice(next, next + copies).map((accessionNo) => ({ schoolId: user.schoolId, bookId: bookId!, accessionNo, campusId: body.campusId ?? null })),
          });
          next += copies;
        }
        // New copies may be wanted by people already queued.
        for (const bookId of touched) await settleHolds(tx, bookId, today);
        return { titles: touched.size, copies: total };
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
    await this.audit.record(user, 'library.import', 'Book', null, { after: added });
    return { ...summary, imported: added.titles, copies: added.copies };
  }
}
