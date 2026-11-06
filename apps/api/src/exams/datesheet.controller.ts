import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { campusScope, STAFF_ROLES } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import {
  CurrentUser,
  Permission,
  RequiresFeature,
  Roles,
} from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { findClashes, sortPapers, type SheetPaper } from './datesheet.js';

const syllabusSchema = z.object({ syllabus: z.string().trim().max(4000) });

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** Datesheets, roll number slips and the syllabus each paper covers. */
@Controller('exams')
@Permission('exams')
@RequiresFeature('exams')
export class DatesheetController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Every paper of the exam in date order, optionally for one class, with any clashes across the whole exam. */
  @Get(':id/datesheet')
  @Roles(...STAFF_ROLES)
  async datesheet(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('classId') classId?: string,
  ) {
    const exam = await this.exam(user, id);
    const all = await this.papers(user, exam.id);
    const papers = classId ? all.filter((p) => p.classId === classId) : all;
    return {
      school: exam.school,
      exam: {
        id: exam.id,
        name: exam.name,
        academicYear: exam.academicYear.name,
        startsOn: iso(exam.startsOn),
        endsOn: iso(exam.endsOn),
      },
      papers,
      clashes: findClashes(all),
    };
  }

  /** Roll number slips for one section: each student with the section's datesheet. */
  @Get(':id/slips')
  @Roles(...STAFF_ROLES)
  async slips(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('sectionId') sectionId: string,
  ) {
    const exam = await this.exam(user, id);
    const section = await this.prisma.section.findFirst({
      where: { id: sectionId ?? '', schoolId: user.schoolId },
      include: { class: { select: { id: true, name: true, campusId: true } } },
    });
    const scope = campusScope(user);
    if (!section || (scope && !scope.includes(section.class.campusId))) {
      throw new NotFoundException('Section not found');
    }
    const [papers, enrolments] = await Promise.all([
      this.papers(user, exam.id, section.class.id),
      this.prisma.enrollment.findMany({
        where: {
          sectionId: section.id,
          academicYearId: exam.academicYearId,
          status: 'ACTIVE',
        },
        orderBy: [{ rollNo: 'asc' }, { student: { firstName: 'asc' } }],
        include: {
          student: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              admissionNo: true,
            },
          },
        },
      }),
    ]);
    return {
      school: exam.school,
      exam: {
        id: exam.id,
        name: exam.name,
        academicYear: exam.academicYear.name,
      },
      section: `${section.class.name} ${section.name}`,
      papers,
      students: enrolments.map((e) => ({
        studentId: e.student.id,
        name: [e.student.firstName, e.student.lastName]
          .filter(Boolean)
          .join(' '),
        admissionNo: e.student.admissionNo,
        rollNo: e.rollNo,
      })),
    };
  }

  /** Sets what a paper covers. Allowed after publishing, since the syllabus is not part of the result. */
  @Put(':id/papers/:paperId/syllabus')
  @Roles(...STAFF_ROLES)
  @Permission('exams', 'manage')
  async setSyllabus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('paperId') paperId: string,
    @Body(new ZodValidationPipe(syllabusSchema))
    body: z.infer<typeof syllabusSchema>,
  ) {
    const exam = await this.exam(user, id);
    const paper = await this.prisma.examPaper.findFirst({
      where: { id: paperId, examId: exam.id },
    });
    if (!paper) throw new NotFoundException('Paper not found');
    await this.prisma.examPaper.update({
      where: { id: paper.id },
      data: { syllabus: body.syllabus || null },
    });
    await this.audit.record(user, 'update', 'ExamPaper', paper.id, {
      before: { syllabus: paper.syllabus },
      after: { syllabus: body.syllabus || null },
    });
    return { id: paper.id, syllabus: body.syllabus || null };
  }

  private async exam(user: AuthUser, id: string) {
    const exam = await this.prisma.exam.findFirst({
      where: { id, schoolId: user.schoolId },
      include: {
        academicYear: { select: { name: true } },
        school: { select: { name: true, logoUrl: true } },
      },
    });
    if (!exam) throw new NotFoundException('Exam not found');
    return exam;
  }

  private async papers(
    user: AuthUser,
    examId: string,
    classId?: string,
  ): Promise<(SheetPaper & { maxMarks: number })[]> {
    const scope = campusScope(user);
    const rows = await this.prisma.examPaper.findMany({
      where: {
        examId,
        ...(classId ? { classId } : {}),
        ...(scope ? { class: { campusId: { in: scope } } } : {}),
      },
      include: {
        class: { select: { name: true, sortOrder: true } },
        subject: { select: { name: true } },
      },
    });
    rows.sort(
      (a, b) =>
        a.class.sortOrder - b.class.sortOrder ||
        a.class.name.localeCompare(b.class.name),
    );
    // Stable sort keeps classes together; each class's papers go in sitting order.
    const classes = [...new Set(rows.map((r) => r.classId))];
    return classes.flatMap((cid) =>
      sortPapers(
        rows
          .filter((r) => r.classId === cid)
          .map((r) => ({
            id: r.id,
            classId: r.classId,
            className: r.class.name,
            subject: r.subject.name,
            date: iso(r.date),
            startTime: r.startTime,
            endTime: r.endTime,
            room: r.room,
            syllabus: r.syllabus,
            maxMarks: r.maxMarks,
          })),
      ),
    );
  }
}
