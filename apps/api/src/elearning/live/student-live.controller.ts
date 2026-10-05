import {
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import type { AuthUser } from '../../common/auth-user.js';
import {
  CurrentUser,
  Permission,
  RequiresFeature,
  Roles,
} from '../../common/decorators.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CoursesService } from '../courses/courses.service.js';
import { JOIN_EARLY_MIN, joinWindow, liveEndsAt } from './live-rules.js';

const RECENT_DAYS = 30;

/**
 * A student's live classes: their current section's classes, live now,
 * upcoming and recent (with recordings). Joining records attendance and is
 * the only way to get the meeting link.
 */
@Controller('student/live')
@Roles(Role.STUDENT)
@Permission('elearning')
@RequiresFeature('elearning')
export class StudentLiveController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly courses: CoursesService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const student = await this.courses.currentStudent(user);
    if (!student.sectionId) return { liveNow: [], upcoming: [], recent: [] };
    const now = new Date();
    const since = new Date(now.getTime() - RECENT_DAYS * 86_400_000);
    const include = {
      subject: { select: { id: true, name: true } },
      teacher: { select: { id: true, name: true } },
      attendance: {
        where: { studentId: student.id },
        select: { joinedAt: true },
      },
    } satisfies Prisma.LiveClassInclude;
    const mine = { schoolId: user.schoolId, sectionId: student.sectionId };
    // Separate limits for what is on now, what is coming and what is past, so
    // a busy month of past classes never pushes upcoming ones off the list.
    const [live, ahead, past] = await Promise.all([
      this.prisma.liveClass.findMany({
        where: { ...mine, status: 'LIVE' },
        orderBy: { startsAt: 'asc' },
        include,
        take: 10,
      }),
      this.prisma.liveClass.findMany({
        where: {
          ...mine,
          status: { in: ['SCHEDULED', 'CANCELLED'] },
          // Started up to a school day ago and still running counts as upcoming.
          startsAt: { gte: new Date(now.getTime() - 12 * 3_600_000) },
        },
        orderBy: { startsAt: 'asc' },
        include,
        take: 60,
      }),
      this.prisma.liveClass.findMany({
        where: { ...mine, status: 'ENDED', startsAt: { gte: since } },
        orderBy: { startsAt: 'desc' },
        include,
        take: 30,
      }),
    ]);
    const rows = [...live, ...ahead, ...past];
    const items = rows.map((c) => ({
      id: c.id,
      title: c.title,
      subject: c.subject,
      teacher: c.teacher,
      startsAt: c.startsAt,
      endsAt: liveEndsAt(c.startsAt, c.durationMin),
      durationMin: c.durationMin,
      provider: c.provider,
      status: c.status,
      recordingUrl: c.status === 'ENDED' ? c.recordingUrl : null,
      joinOpensAt: new Date(c.startsAt.getTime() - JOIN_EARLY_MIN * 60_000),
      joinWindow: joinWindow(c, now),
      attended: c.attendance.length > 0,
      joinedAt: c.attendance[0]?.joinedAt ?? null,
    }));
    return {
      liveNow: items.filter((c) => c.status === 'LIVE'),
      upcoming: items
        .filter(
          (c) =>
            (c.status === 'SCHEDULED' || c.status === 'CANCELLED') &&
            c.endsAt > now,
        )
        .slice(0, 30),
      recent: items.filter((c) => c.status === 'ENDED').slice(0, 30),
    };
  }

  /** Records that the student joined and hands back the meeting link, from 15 minutes before the start until the end. */
  @Post(':id/join')
  @Permission('elearning', 'view')
  async join(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const { cls, studentId } = await this.visibleClass(user, id);
    const window = joinWindow(cls);
    if (cls.status === 'CANCELLED')
      throw new ConflictException('This class was cancelled');
    if (window === 'early') {
      throw new ConflictException(
        `You can join from ${JOIN_EARLY_MIN} minutes before the class starts`,
      );
    }
    if (window === 'closed')
      throw new ConflictException('This class has ended');
    const record = await this.prisma.liveAttendance.upsert({
      where: { liveClassId_studentId: { liveClassId: cls.id, studentId } },
      create: { liveClassId: cls.id, studentId },
      update: { leftAt: null },
    });
    return {
      liveClassId: cls.id,
      joinUrl: cls.joinUrl,
      provider: cls.provider,
      joinedAt: record.joinedAt,
    };
  }

  /** Notes when the student left (best effort, e.g. on closing the meeting tab). */
  @Post(':id/leave')
  @Permission('elearning', 'view')
  async leave(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const { cls, studentId } = await this.visibleClass(user, id);
    const updated = await this.prisma.liveAttendance.updateMany({
      where: { liveClassId: cls.id, studentId },
      data: { leftAt: new Date() },
    });
    return { left: updated.count > 0 };
  }

  private async visibleClass(user: AuthUser, id: string) {
    const student = await this.courses.currentStudent(user);
    const cls = student.sectionId
      ? await this.prisma.liveClass.findFirst({
          where: {
            id: id ?? '',
            schoolId: user.schoolId,
            sectionId: student.sectionId,
          },
        })
      : null;
    if (!cls) throw new NotFoundException('Live class not found');
    return { cls, studentId: student.id };
  }
}
