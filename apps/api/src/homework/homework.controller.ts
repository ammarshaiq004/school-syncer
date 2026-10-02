import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import {
  ATTENDANCE_ROLES,
  campusScope,
  hasAnyRole,
  SETUP_ROLES,
  STAFF_ROLES,
} from '../common/admin-roles.js';
import type { AuthUser } from '../common/auth-user.js';
import { dayStart, daysBefore, localToday } from '../common/dates.js';
import { CurrentUser, Roles } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { guardianPhones } from '../notifications/guardian-contacts.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const homeworkSchema = z.object({
  sectionId: z.string().min(1),
  subjectId: z.string().min(1),
  title: z.string().trim().min(2).max(120),
  details: z.string().trim().max(2000).optional(),
  dueDate: isoDate,
  sendWhatsApp: z.boolean().default(false),
});

@Controller('homework')
export class HomeworkController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Homework for a section, by due date; defaults to the last week onwards. */
  @Get()
  @Roles(...STAFF_ROLES)
  async list(
    @CurrentUser() user: AuthUser,
    @Query('sectionId') sectionId: string,
    @Query('from', new ZodValidationPipe(isoDate.optional())) from?: string,
  ) {
    await this.sectionInScope(user, sectionId);
    const items = await this.prisma.homework.findMany({
      where: { sectionId, dueDate: { gte: dayStart(from ?? daysBefore(localToday(), 7)) } },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
      include: {
        subject: { select: { name: true } },
        assignedBy: { select: { id: true, name: true } },
      },
    });
    return items.map((h) => ({ ...h, canDelete: h.assignedById === user.sub || hasAnyRole(user, SETUP_ROLES) }));
  }

  /** Teachers set homework for subjects they teach (class teachers for any subject in their section). */
  @Post()
  @Roles(...ATTENDANCE_ROLES)
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(homeworkSchema)) body: z.infer<typeof homeworkSchema>,
  ) {
    const section = await this.sectionInScope(user, body.sectionId);
    const teaches = section.subjects.find((s) => s.subjectId === body.subjectId);
    if (!teaches) throw new NotFoundException('This subject is not taught in this section');
    const isAdmin = hasAnyRole(user, SETUP_ROLES);
    if (!isAdmin && teaches.teacherId !== user.sub && section.classTeacherId !== user.sub) {
      throw new ForbiddenException('You do not teach this subject in this section');
    }
    if (body.dueDate < localToday()) throw new ForbiddenException('The due date has already passed');

    const homework = await this.prisma.homework.create({
      data: {
        schoolId: user.schoolId,
        sectionId: section.id,
        subjectId: body.subjectId,
        assignedById: user.sub,
        title: body.title,
        details: body.details,
        dueDate: dayStart(body.dueDate),
      },
      include: { subject: { select: { name: true } } },
    });

    let messagesSent = 0;
    if (body.sendWhatsApp) {
      const enrolled = await this.prisma.enrollment.findMany({
        where: { sectionId: section.id, status: 'ACTIVE' },
        select: { studentId: true },
      });
      const phones = await guardianPhones(this.prisma, enrolled.map((e) => e.studentId));
      const params = {
        className: `${section.class.name} ${section.name}`,
        subject: homework.subject.name,
        title: homework.title,
        dueDate: body.dueDate,
        schoolName: section.class.school.name,
      };
      messagesSent = await this.notifications.send(
        user.schoolId,
        [...phones.values()].flat().map((to) => ({ to, template: 'homework.assigned' as const, params })),
      );
    }
    return { ...homework, messagesSent };
  }

  @Delete(':id')
  @Roles(...ATTENDANCE_ROLES)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const homework = await this.prisma.homework.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!homework) throw new NotFoundException('Homework not found');
    await this.sectionInScope(user, homework.sectionId);
    if (homework.assignedById !== user.sub && !hasAnyRole(user, SETUP_ROLES)) {
      throw new ForbiddenException('Only the teacher who set it can remove this homework');
    }
    await this.prisma.homework.delete({ where: { id } });
    return { deleted: true };
  }

  private async sectionInScope(user: AuthUser, sectionId: string) {
    const section = await this.prisma.section.findFirst({
      where: { id: sectionId ?? '', schoolId: user.schoolId },
      include: {
        class: { select: { name: true, campusId: true, school: { select: { name: true } } } },
        subjects: { select: { subjectId: true, teacherId: true } },
      },
    });
    const scope = campusScope(user);
    if (!section || (scope && !scope.includes(section.class.campusId))) {
      throw new NotFoundException('Section not found');
    }
    return section;
  }
}
