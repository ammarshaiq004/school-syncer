import { Body, Controller, ForbiddenException, Get, NotFoundException, Post } from '@nestjs/common';
import { Audience, Prisma } from '@prisma/client';
import { z } from 'zod';
import { adminScope, SETUP_ROLES, STAFF_ROLES } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Permission, Roles } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { guardianPhones } from '../notifications/guardian-contacts.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const announcementSchema = z
  .object({
    title: z.string().trim().min(2).max(120),
    body: z.string().trim().min(2).max(2000),
    audience: z.enum(Audience),
    targetId: z.string().optional(),
    sendWhatsApp: z.boolean().default(true),
  })
  .refine((a) => a.audience === Audience.SCHOOL || a.targetId, {
    message: 'Pick the campus, class or section',
    path: ['targetId'],
  });
type AnnouncementInput = z.infer<typeof announcementSchema>;

@Controller('announcements')
@Permission('announcements')
export class AnnouncementsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  @Get()
  @Roles(...STAFF_ROLES)
  list(@CurrentUser() user: AuthUser) {
    return this.prisma.announcement.findMany({
      where: { schoolId: user.schoolId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { createdBy: { select: { name: true } } },
    });
  }

  /** Posts a notice and, if asked, sends it to the guardians of every student in the audience. */
  @Post()
  @Roles(...SETUP_ROLES)
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(announcementSchema)) body: AnnouncementInput,
  ) {
    const enrollment = await this.audienceFilter(user, body);
    const announcement = await this.prisma.announcement.create({
      data: { ...body, schoolId: user.schoolId, createdById: user.sub },
    });

    let messages = 0;
    if (body.sendWhatsApp) {
      const students = await this.prisma.student.findMany({
        where: { schoolId: user.schoolId, status: 'ACTIVE', enrollments: { some: enrollment } },
        select: { id: true },
      });
      const phones = await guardianPhones(this.prisma, students.map((s) => s.id));
      const school = await this.prisma.school.findUniqueOrThrow({ where: { id: user.schoolId } });
      const unique = [...new Set([...phones.values()].flat())];
      messages = await this.notifications.send(
        user.schoolId,
        unique.map((to) => ({
          to,
          template: 'announcement' as const,
          params: { schoolName: school.name, title: body.title, body: body.body },
        })),
      );
    }
    await this.audit.record(user, 'announcement.create', 'Announcement', announcement.id, {
      after: announcement,
    });
    return { ...announcement, messages };
  }

  /** A campus-limited admin may only address their own campuses (or a class or section in them). */
  private async audienceFilter(
    user: AuthUser,
    body: AnnouncementInput,
  ): Promise<Prisma.EnrollmentWhereInput> {
    const active = { status: 'ACTIVE' as const, academicYear: { isCurrent: true } };
    const scope = adminScope(user);
    if (body.audience === Audience.SCHOOL) {
      if (scope) throw new ForbiddenException('Only school-wide staff can address the whole school');
      return active;
    }
    const where = { id: body.targetId, schoolId: user.schoolId };
    const campusId =
      body.audience === Audience.CAMPUS
        ? (await this.prisma.campus.findFirst({ where, select: { id: true } }))?.id
        : body.audience === Audience.CLASS
          ? (await this.prisma.class.findFirst({ where, select: { campusId: true } }))?.campusId
          : (await this.prisma.section.findFirst({ where, select: { class: { select: { campusId: true } } } }))?.class
              .campusId;
    if (!campusId) throw new NotFoundException('Audience not found');
    if (scope && !scope.includes(campusId)) throw new ForbiddenException('That campus is not yours to address');
    if (body.audience === Audience.CAMPUS) return { ...active, section: { class: { campusId: body.targetId } } };
    if (body.audience === Audience.CLASS) return { ...active, section: { classId: body.targetId } };
    return { ...active, sectionId: body.targetId };
  }
}
