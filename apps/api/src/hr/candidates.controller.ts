import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { CandidateStatus, FilePurpose, type Prisma } from '@prisma/client';
import { z } from 'zod';
import { SETUP_ROLES } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Permission, RequiresFeature, Roles } from '../common/decorators.js';
import { phoneField } from '../common/identity.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { FilesService, type UploadedTemp } from '../elearning/files/files.service.js';
import { UploadInterceptor } from '../elearning/files/upload.interceptor.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { candidateSearchWhere } from './candidate-search.js';

const candidateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: phoneField.optional(),
  email: z.email().toLowerCase().optional(),
  position: z.string().trim().min(2).max(80),
  qualification: z.string().trim().max(120).optional(),
  experienceYears: z.number().int().min(0).max(60).default(0),
  expectedSalary: z.number().int().min(0).max(100_000_000).optional(),
  source: z.string().trim().max(60).optional(),
  status: z.enum(CandidateStatus).default(CandidateStatus.NEW),
  notes: z.string().trim().max(2000).optional(),
  cvId: z.string().min(1).nullish(),
});
type CandidateInput = z.infer<typeof candidateSchema>;

const listSchema = z.object({
  search: z.string().max(120).optional(),
  status: z.enum(CandidateStatus).optional(),
});

/** The CV bank: applicants kept for the next vacancy, each with an optional CV file. */
@Controller('hr/candidates')
@Permission('hr')
@RequiresFeature('hr')
@Roles(...SETUP_ROLES)
export class CandidatesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
  ) {}

  /** A pdf, Word file or photo of a CV, up to 10 MB; returns the file to attach. */
  @Post('cv')
  @UseInterceptors(UploadInterceptor(() => [FilePurpose.CANDIDATE_CV]))
  upload(@CurrentUser() user: AuthUser, @UploadedFile() temp?: UploadedTemp) {
    return this.files.upload(user, FilePurpose.CANDIDATE_CV, temp);
  }

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listSchema)) query: z.infer<typeof listSchema>,
  ) {
    const rows = await this.prisma.candidate.findMany({
      where: { schoolId: user.schoolId, ...(query.status ? { status: query.status } : {}), ...candidateSearchWhere(query.search) },
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: { cv: true },
    });
    return Promise.all(rows.map((c) => this.view(c)));
  }

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(candidateSchema)) body: CandidateInput,
  ) {
    const { cvId, ...fields } = body;
    await this.assertCv(user, cvId);
    const created = await this.prisma.candidate.create({
      data: { ...fields, schoolId: user.schoolId, cvId: cvId ?? null, createdById: user.sub },
      include: { cv: true },
    });
    await this.audit.record(user, 'create', 'Candidate', created.id, { after: fields });
    return this.view(created);
  }

  @Put(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(candidateSchema)) body: CandidateInput,
  ) {
    const before = await this.find(user, id);
    const { cvId, ...fields } = body;
    // undefined keeps the current CV; null removes it.
    if (cvId && cvId !== before.cvId) await this.assertCv(user, cvId);
    const updated = await this.prisma.candidate.update({
      where: { id },
      data: {
        ...fields,
        phone: fields.phone ?? null,
        email: fields.email ?? null,
        qualification: fields.qualification ?? null,
        expectedSalary: fields.expectedSalary ?? null,
        source: fields.source ?? null,
        notes: fields.notes ?? null,
        ...(cvId === undefined ? {} : { cvId }),
      },
      include: { cv: true },
    });
    if (cvId !== undefined && before.cvId && before.cvId !== cvId) await this.files.release([before.cvId]);
    await this.audit.record(user, 'update', 'Candidate', id, { before: { status: before.status }, after: fields });
    return this.view(updated);
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const before = await this.find(user, id);
    await this.prisma.candidate.delete({ where: { id } });
    await this.files.release([before.cvId]);
    await this.audit.record(user, 'delete', 'Candidate', id, { before: { name: before.name, position: before.position } });
    return { deleted: true };
  }

  private async find(user: AuthUser, id: string) {
    const found = await this.prisma.candidate.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!found) throw new NotFoundException('Candidate not found');
    return found;
  }

  /** The CV must be this user's own fresh upload, not attached to anyone yet. */
  private async assertCv(user: AuthUser, cvId: string | null | undefined) {
    if (!cvId) return;
    const file = await this.prisma.storedFile.findFirst({
      where: { id: cvId, schoolId: user.schoolId, purpose: FilePurpose.CANDIDATE_CV, uploadedById: user.sub, candidateCv: null },
      select: { id: true },
    });
    if (!file) throw new BadRequestException('Upload the CV again before saving');
  }

  private async view(c: Prisma.CandidateGetPayload<{ include: { cv: true } }>) {
    const { cv, ...rest } = c;
    return { ...rest, cv: cv ? await this.files.link(cv) : null };
  }
}
