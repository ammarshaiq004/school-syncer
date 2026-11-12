import { Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { SyllabusStatus } from '@prisma/client';
import { z } from 'zod';
import { administers, ATTENDANCE_ROLES, campusScope, workingSections } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { localToday } from '../common/dates.js';
import { CurrentUser, Permission, Roles } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { parseTopicLines, syllabusProgress } from './syllabus-rules.js';

const pair = z.object({ sectionId: z.string().min(1), subjectId: z.string().min(1) });
const addSchema = pair.extend({ topics: z.string().min(1).max(20000) });
const patchSchema = z.object({ status: z.enum(SyllabusStatus).optional(), title: z.string().trim().min(1).max(160).optional() });

/**
 * The topics each section must cover in a subject, and how far the teacher has got.
 * Teachers manage the sections and subjects they teach; setup roles manage every one in their campuses.
 */
@Controller('syllabus')
@Permission('lesson_plans')
@Roles(...ATTENDANCE_ROLES)
export class SyllabusController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The section is in this user's reach (404 otherwise); returns whether they may change its syllabus for the subject. */
  private async reach(user: AuthUser, sectionId: string, subjectId: string) {
    const scope = campusScope(user);
    const section = await this.prisma.section.findFirst({
      where: { id: sectionId, schoolId: user.schoolId, ...(scope ? { class: { campusId: { in: scope } } } : {}), ...workingSections(user) },
      select: { classTeacherId: true, class: { select: { campusId: true } }, subjects: { where: { subjectId }, select: { teacherId: true } } },
    });
    if (!section || !section.subjects.length) throw new NotFoundException('Section or subject not found');
    const canEdit = administers(user, section.class.campusId) || section.classTeacherId === user.sub || section.subjects[0].teacherId === user.sub;
    return canEdit;
  }

  private async topicFor(user: AuthUser, id: string) {
    const topic = await this.prisma.syllabusTopic.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!topic) throw new NotFoundException('Topic not found');
    if (!(await this.reach(user, topic.sectionId, topic.subjectId))) throw new ForbiddenException('You do not teach this subject');
    return topic;
  }

  /** Progress per section and subject, for the sections this user works with. */
  @Get('overview')
  async overview(@CurrentUser() user: AuthUser) {
    const scope = campusScope(user);
    const sections = await this.prisma.section.findMany({
      where: { schoolId: user.schoolId, academicYear: { isCurrent: true }, ...(scope ? { class: { campusId: { in: scope } } } : {}), ...workingSections(user) },
      orderBy: [{ class: { sortOrder: 'asc' } }, { name: 'asc' }],
      select: { id: true, name: true, class: { select: { name: true } }, subjects: { select: { subject: { select: { id: true, name: true } } } } },
    });
    const topics = await this.prisma.syllabusTopic.findMany({
      where: { schoolId: user.schoolId, sectionId: { in: sections.map((s) => s.id) } },
      select: { sectionId: true, subjectId: true, status: true },
    });
    return sections.flatMap((s) =>
      s.subjects.map(({ subject }) => ({
        sectionId: s.id,
        sectionName: `${s.class.name} ${s.name}`,
        subjectId: subject.id,
        subjectName: subject.name,
        ...syllabusProgress(topics.filter((t) => t.sectionId === s.id && t.subjectId === subject.id)),
      })),
    );
  }

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(pair)) q: z.infer<typeof pair>) {
    const canEdit = await this.reach(user, q.sectionId, q.subjectId);
    const topics = await this.prisma.syllabusTopic.findMany({
      where: { schoolId: user.schoolId, sectionId: q.sectionId, subjectId: q.subjectId },
      orderBy: { position: 'asc' },
      select: { id: true, title: true, position: true, status: true, completedOn: true },
    });
    return { canEdit, progress: syllabusProgress(topics), topics };
  }

  /** Adds topics, one per line, after the existing ones. */
  @Post()
  async add(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(addSchema)) body: z.infer<typeof addSchema>) {
    if (!(await this.reach(user, body.sectionId, body.subjectId))) throw new ForbiddenException('You do not teach this subject');
    const titles = parseTopicLines(body.topics).slice(0, 200);
    if (!titles.length) return { added: 0 };
    const last = await this.prisma.syllabusTopic.aggregate({ where: { sectionId: body.sectionId, subjectId: body.subjectId }, _max: { position: true } });
    const start = (last._max.position ?? 0) + 1;
    await this.prisma.syllabusTopic.createMany({
      data: titles.map((title, i) => ({ schoolId: user.schoolId, sectionId: body.sectionId, subjectId: body.subjectId, title, position: start + i, createdById: user.sub })),
    });
    await this.audit.record(user, 'syllabus.add', 'Section', body.sectionId, { after: { subjectId: body.subjectId, topics: titles.length } });
    return { added: titles.length };
  }

  @Patch(':id')
  async update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodValidationPipe(patchSchema)) body: z.infer<typeof patchSchema>) {
    const topic = await this.topicFor(user, id);
    const updated = await this.prisma.syllabusTopic.update({
      where: { id },
      data: {
        ...(body.title ? { title: body.title } : {}),
        ...(body.status ? { status: body.status, completedOn: body.status === SyllabusStatus.DONE ? new Date(`${localToday()}T00:00:00Z`) : null } : {}),
      },
      select: { id: true, title: true, position: true, status: true, completedOn: true },
    });
    if (body.status && body.status !== topic.status) {
      await this.audit.record(user, 'syllabus.status', 'Section', topic.sectionId, { before: { topic: topic.title, status: topic.status }, after: { status: body.status } });
    }
    return updated;
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const topic = await this.topicFor(user, id);
    await this.prisma.syllabusTopic.delete({ where: { id } });
    await this.audit.record(user, 'syllabus.remove', 'Section', topic.sectionId, { before: { topic: topic.title } });
    return { deleted: true };
  }
}
