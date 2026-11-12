import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FilePurpose } from '@prisma/client';
import { z } from 'zod';
import { adminScope, SETUP_ROLES } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Permission, Roles } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { FilesService, type UploadedTemp } from '../elearning/files/files.service.js';
import { UploadInterceptor } from '../elearning/files/upload.interceptor.js';
import { PrismaService } from '../prisma/prisma.service.js';

const documentSchema = z.object({
  fileId: z.string().min(1),
  type: z.string().trim().min(2).max(60),
  title: z.string().trim().min(1).max(120),
});
const noteSchema = z.object({ body: z.string().trim().min(1).max(2000) });
const typesSchema = z.object({
  types: z.array(z.string().trim().min(2).max(60)).min(1).max(30),
});

/** Documents and internal notes kept on a student's file. Office staff only: parents and students never see them. */
@Controller('students')
@Permission('students')
@Roles(...SETUP_ROLES)
export class StudentExtrasController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
  ) {}

  private async student(user: AuthUser, id: string) {
    const scope = adminScope(user);
    const found = await this.prisma.student.findFirst({ where: { id, schoolId: user.schoolId }, select: { id: true, campusId: true } });
    if (!found) throw new NotFoundException('Student not found');
    if (scope && !scope.includes(found.campusId)) throw new ForbiddenException('Student is at another campus');
    return found;
  }

  /** The kinds of document the school files, e.g. "Birth certificate / B-Form". */
  @Get('config/document-types')
  async documentTypes(@CurrentUser() user: AuthUser) {
    return (await this.prisma.school.findUniqueOrThrow({ where: { id: user.schoolId }, select: { documentTypes: true } })).documentTypes;
  }

  @Put('config/document-types')
  async setDocumentTypes(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(typesSchema)) body: z.infer<typeof typesSchema>) {
    const types = [...new Set(body.types)];
    await this.prisma.school.update({ where: { id: user.schoolId }, data: { documentTypes: types } });
    await this.audit.record(user, 'student.document_types', 'School', user.schoolId, { after: { types } });
    return types;
  }

  /** A pdf, Word file or photo up to 10 MB; returns the file to attach with POST :id/documents. */
  @Post('files/upload')
  @UseInterceptors(UploadInterceptor(() => [FilePurpose.STUDENT_DOCUMENT]))
  upload(@CurrentUser() user: AuthUser, @UploadedFile() temp?: UploadedTemp) {
    return this.files.upload(user, FilePurpose.STUDENT_DOCUMENT, temp);
  }

  @Get(':id/documents')
  async documents(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.student(user, id);
    const rows = await this.prisma.studentDocument.findMany({
      where: { studentId: id, schoolId: user.schoolId },
      orderBy: { createdAt: 'desc' },
      include: { file: true },
    });
    return Promise.all(rows.map(async ({ file, ...d }) => ({ ...d, file: await this.files.link(file) })));
  }

  @Post(':id/documents')
  async addDocument(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(documentSchema)) body: z.infer<typeof documentSchema>,
  ) {
    await this.student(user, id);
    const types = (await this.prisma.school.findUniqueOrThrow({ where: { id: user.schoolId }, select: { documentTypes: true } })).documentTypes;
    if (!types.includes(body.type)) throw new BadRequestException(`"${body.type}" is not one of the school's document types`);
    // The file must be this user's own fresh upload, not attached to anything yet.
    const file = await this.prisma.storedFile.findFirst({
      where: { id: body.fileId, schoolId: user.schoolId, purpose: FilePurpose.STUDENT_DOCUMENT, uploadedById: user.sub, studentDocument: null },
    });
    if (!file) throw new BadRequestException('Upload the file again before saving');
    const created = await this.prisma.studentDocument.create({
      data: { schoolId: user.schoolId, studentId: id, type: body.type, title: body.title, fileId: file.id, createdById: user.sub },
    });
    await this.audit.record(user, 'student.document_add', 'Student', id, { after: { type: body.type, title: body.title } });
    return { ...created, file: await this.files.link(file) };
  }

  @Delete(':id/documents/:documentId')
  async removeDocument(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('documentId') documentId: string) {
    await this.student(user, id);
    const doc = await this.prisma.studentDocument.findFirst({ where: { id: documentId, studentId: id, schoolId: user.schoolId } });
    if (!doc) throw new NotFoundException('Document not found');
    await this.prisma.studentDocument.delete({ where: { id: doc.id } });
    await this.files.release([doc.fileId]);
    await this.audit.record(user, 'student.document_remove', 'Student', id, { before: { type: doc.type, title: doc.title } });
    return { deleted: true };
  }

  @Get(':id/notes')
  async notes(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.student(user, id);
    const rows = await this.prisma.studentNote.findMany({ where: { studentId: id, schoolId: user.schoolId }, orderBy: { createdAt: 'desc' }, take: 200 });
    const authors = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(rows.flatMap((r) => (r.createdById ? [r.createdById] : [])))] } },
      select: { id: true, name: true },
    });
    return rows.map((r) => ({ id: r.id, body: r.body, createdAt: r.createdAt, by: authors.find((a) => a.id === r.createdById)?.name ?? null }));
  }

  @Post(':id/notes')
  async addNote(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodValidationPipe(noteSchema)) body: z.infer<typeof noteSchema>) {
    await this.student(user, id);
    const note = await this.prisma.studentNote.create({ data: { schoolId: user.schoolId, studentId: id, body: body.body, createdById: user.sub } });
    await this.audit.record(user, 'student.note_add', 'Student', id, { after: { noteId: note.id } });
    return note;
  }

  @Delete(':id/notes/:noteId')
  async removeNote(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('noteId') noteId: string) {
    await this.student(user, id);
    const note = await this.prisma.studentNote.findFirst({ where: { id: noteId, studentId: id, schoolId: user.schoolId } });
    if (!note) throw new NotFoundException('Note not found');
    await this.prisma.studentNote.delete({ where: { id: note.id } });
    await this.audit.record(user, 'student.note_remove', 'Student', id, { before: { noteId } });
    return { deleted: true };
  }
}
