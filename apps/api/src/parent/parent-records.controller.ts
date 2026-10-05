import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { InvoiceStatus, Role } from '@prisma/client';
import { z } from 'zod';
import type { AuthUser } from '../common/auth-user.js';
import { dayStart, daysBefore, localToday } from '../common/dates.js';
import {
  CurrentUser,
  Permission,
  RequiresFeature,
  Roles,
} from '../common/decorators.js';
import { lateFine } from '../fees/fee-calculator.js';
import { isoDay } from '../lesson-plans/lesson-plan-rules.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  attendanceTally,
  invoiceBreakdown,
  invoiceDisplayStatus,
  monthlyTallies,
} from './parent-rules.js';

// Rejects impossible days such as 2026-02-30 (they would reach Prisma as Invalid Date).
const isoDate = isoDay;
const MAX_RANGE_DAYS = 366;

const name = (s: { firstName: string; lastName: string | null }) =>
  [s.firstName, s.lastName].filter(Boolean).join(' ');

const activeClass = {
  enrollments: {
    where: { status: 'ACTIVE' as const },
    orderBy: [
      { academicYear: { isCurrent: 'desc' as const } },
      { createdAt: 'desc' as const },
    ],
    take: 1,
    select: {
      section: { select: { name: true, class: { select: { name: true } } } },
    },
  },
};

function className(s: {
  enrollments: { section: { name: string; class: { name: string } } }[];
}) {
  const e = s.enrollments[0];
  return e ? `${e.section.class.name} ${e.section.name}` : null;
}

/**
 * Parent-facing fee invoices (AcademiaOS module C) and attendance history.
 * Every lookup goes through the signed-in guardian's own children in their
 * school; anything else is 404.
 */
@Controller('parent')
@Roles(Role.PARENT)
export class ParentRecordsController {
  constructor(private readonly prisma: PrismaService) {}

  /** Every invoice of every child (cancelled ones left out), newest period first. */
  @Get('invoices')
  @Permission('fees')
  @RequiresFeature('fees')
  async invoices(@CurrentUser() user: AuthUser) {
    const [invoices, school] = await Promise.all([
      this.prisma.invoice.findMany({
        where: {
          schoolId: user.schoolId,
          status: { not: InvoiceStatus.CANCELLED },
          student: { guardians: { some: { guardian: { userId: user.sub } } } },
        },
        orderBy: [{ period: 'desc' }, { createdAt: 'desc' }],
        take: 500,
        include: {
          student: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              admissionNo: true,
              ...activeClass,
            },
          },
        },
      }),
      this.prisma.school.findUniqueOrThrow({
        where: { id: user.schoolId },
        select: { lateFeePerDay: true },
      }),
    ]);
    const today = localToday();
    // Late fees count whole school-local days, matching the OVERDUE badge.
    const asOf = dayStart(today);
    const items = invoices.map((i) => {
      const displayStatus = invoiceDisplayStatus(i, today);
      const balance = Math.max(i.total - i.paid, 0);
      const fine =
        balance > 0 ? lateFine(i.dueDate, asOf, school.lateFeePerDay) : 0;
      return {
        id: i.id,
        voucherNo: i.voucherNo,
        period: i.period,
        issueDate: i.issueDate.toISOString().slice(0, 10),
        dueDate: i.dueDate.toISOString().slice(0, 10),
        total: i.total,
        paid: i.paid,
        balance,
        lateFine: fine,
        totalDue: balance > 0 ? balance + fine : 0,
        status: i.status,
        displayStatus,
        student: {
          id: i.student.id,
          name: name(i.student),
          admissionNo: i.student.admissionNo,
          className: className(i.student),
        },
      };
    });
    return {
      items,
      summary: {
        totalDue: items.reduce((s, i) => s + i.totalDue, 0),
        pendingCount: items.filter((i) => i.displayStatus === 'PENDING').length,
        overdueCount: items.filter((i) => i.displayStatus === 'OVERDUE').length,
        paidCount: items.filter((i) => i.displayStatus === 'PAID').length,
      },
    };
  }

  /** One invoice of one of my children, with its line items, breakdown and payments. */
  @Get('invoices/:id')
  @Permission('fees')
  @RequiresFeature('fees')
  async invoice(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const i = await this.prisma.invoice.findFirst({
      where: {
        id: id ?? '',
        schoolId: user.schoolId,
        student: { guardians: { some: { guardian: { userId: user.sub } } } },
      },
      include: {
        school: {
          select: {
            name: true,
            city: true,
            phone: true,
            email: true,
            logoUrl: true,
            currency: true,
            lateFeePerDay: true,
          },
        },
        lines: {
          orderBy: { amount: 'desc' },
          select: {
            id: true,
            description: true,
            amount: true,
            feeHeadId: true,
          },
        },
        payments: {
          orderBy: { receivedAt: 'asc' },
          select: {
            id: true,
            amount: true,
            method: true,
            reference: true,
            receiptNo: true,
            receivedAt: true,
          },
        },
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            admissionNo: true,
            ...activeClass,
          },
        },
      },
    });
    if (!i) throw new NotFoundException('Invoice not found');
    const { lateFeePerDay, ...school } = i.school;
    const fine =
      i.total - i.paid > 0
        ? lateFine(i.dueDate, dayStart(localToday()), lateFeePerDay)
        : 0;
    return {
      id: i.id,
      voucherNo: i.voucherNo,
      period: i.period,
      issueDate: i.issueDate.toISOString().slice(0, 10),
      dueDate: i.dueDate.toISOString().slice(0, 10),
      status: i.status,
      displayStatus: invoiceDisplayStatus(i, localToday()),
      school,
      student: {
        id: i.student.id,
        name: name(i.student),
        admissionNo: i.student.admissionNo,
        className: className(i.student),
      },
      lines: i.lines,
      breakdown: invoiceBreakdown(i.lines, i, fine),
      payments: i.payments,
    };
  }

  /**
   * One child's attendance between two days (default: the last 26 weeks up
   * to today; at most 366 days): every recorded day, totals and a monthly table.
   */
  @Get('children/:id/attendance')
  @Permission('attendance')
  async attendance(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('from') fromParam?: string,
    @Query('to') toParam?: string,
  ) {
    const today = localToday();
    const range = z.object({ from: isoDate, to: isoDate }).safeParse({
      from: fromParam || daysBefore(today, 26 * 7 - 1),
      to: toParam || today,
    });
    if (!range.success || range.data.from > range.data.to) {
      throw new BadRequestException(
        'Use a from date on or before the to date, as YYYY-MM-DD',
      );
    }
    const { from, to } = range.data;
    const span =
      (dayStart(to).getTime() - dayStart(from).getTime()) / 86_400_000 + 1;
    if (span > MAX_RANGE_DAYS) {
      throw new BadRequestException('Choose a range of a year or less');
    }

    const student = await this.prisma.student.findFirst({
      where: {
        id: id ?? '',
        schoolId: user.schoolId,
        guardians: { some: { guardian: { userId: user.sub } } },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        admissionNo: true,
        photoUrl: true,
        ...activeClass,
      },
    });
    if (!student) throw new NotFoundException('Child not found');

    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        studentId: student.id,
        session: { date: { gte: dayStart(from), lte: dayStart(to) } },
      },
      orderBy: { session: { date: 'asc' } },
      select: { status: true, note: true, session: { select: { date: true } } },
    });
    const days = records.map((r) => ({
      date: r.session.date.toISOString().slice(0, 10),
      status: r.status,
      note: r.note,
    }));
    return {
      student: {
        id: student.id,
        name: name(student),
        admissionNo: student.admissionNo,
        photoUrl: student.photoUrl,
        className: className(student),
      },
      from,
      to,
      days,
      summary: attendanceTally(days.map((d) => d.status)),
      months: monthlyTallies(days),
    };
  }
}
