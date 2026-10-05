import { tmpdir } from 'node:os';
import {
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { FilePurpose, Role } from '@prisma/client';
import type { Response } from 'express';
import { z } from 'zod';
import { ATTENDANCE_ROLES, STAFF_ROLES } from '../../common/admin-roles.js';
import type { AuthUser } from '../../common/auth-user.js';
import { CurrentUser, Permission, Public, RequiresFeature, Roles } from '../../common/decorators.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { acceptedExtensions, contentDisposition, LIMITS, MAX_UPLOAD_BYTES } from './file-rules.js';
import { FilesService, type UploadedTemp } from './files.service.js';
import { LocalStorageDriver } from './storage/local.driver.js';
import { STORAGE_DRIVER, type StorageDriver } from './storage/storage-driver.js';

/** Multer writes uploads to a temp file (never memory), capped at the largest allowed file. */
const uploadInterceptor = FileInterceptor('file', {
  dest: tmpdir(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5 },
});

const staffPurpose = z.object({ purpose: z.enum([FilePurpose.LESSON, FilePurpose.ASSIGNMENT]) });

/**
 * Upload and open e-school files. Teachers upload lesson videos and
 * documents and assignment attachments; students upload their work. A file
 * is attached by passing its id when saving the lesson, assignment or
 * submission. Opening a file returns a short-lived link.
 */
@Controller()
@RequiresFeature('elearning')
export class FilesController {
  constructor(
    private readonly files: FilesService,
    private readonly prisma: PrismaService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  /** Accepted types and size limits per purpose, for the file pickers. */
  @Get('files/rules')
  @Roles(...STAFF_ROLES, Role.STUDENT)
  @Permission('elearning', 'view')
  rules() {
    return Object.fromEntries(
      Object.values(FilePurpose).map((p) => [p, { extensions: acceptedExtensions(p), maxBytes: LIMITS[p] }]),
    );
  }

  @Post('elearning/files')
  @Roles(...ATTENDANCE_ROLES)
  @Permission('elearning')
  @UseInterceptors(uploadInterceptor)
  upload(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(staffPurpose)) query: z.infer<typeof staffPurpose>,
    @UploadedFile() file?: UploadedTemp,
  ) {
    return this.files.upload(user, query.purpose, file);
  }

  /** Students only ever upload their own work, so view access is enough. */
  @Post('student/files')
  @Roles(Role.STUDENT)
  @Permission('elearning', 'view')
  @UseInterceptors(uploadInterceptor)
  uploadWork(@CurrentUser() user: AuthUser, @UploadedFile() file?: UploadedTemp) {
    return this.files.upload(user, FilePurpose.SUBMISSION, file);
  }

  @Get('elearning/files/usage')
  @Roles(...STAFF_ROLES)
  @Permission('elearning', 'view')
  usage(@CurrentUser() user: AuthUser) {
    return this.files.usage(user.schoolId);
  }

  /** A fresh link to a file this user may see. */
  @Get('files/:id')
  @Roles(...STAFF_ROLES, Role.STUDENT)
  @Permission('elearning', 'view')
  link(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.files.linkFor(user, id);
  }

  /** Removes a file its uploader has not attached to anything yet. */
  @Delete('files/:id')
  @Roles(...STAFF_ROLES, Role.STUDENT)
  @Permission('elearning', 'view')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.files.removeUnattached(user, id);
  }

  /**
   * The bytes of a locally stored file, for the signed links the local driver
   * hands out (S3 links go straight to the bucket). Supports range requests,
   * so videos can seek.
   */
  @Get('files/:id/content')
  @Public()
  async content(
    @Param('id') id: string,
    @Query('exp') exp: string | undefined,
    @Query('sig') sig: string | undefined,
    @Res() res: Response,
  ) {
    const driver = this.storage;
    if (!(driver instanceof LocalStorageDriver) || !driver.verify(id, exp, sig)) {
      throw new NotFoundException('This link has expired. Open the file again.');
    }
    const file = await this.prisma.storedFile.findUnique({ where: { id } });
    if (!file) throw new NotFoundException('File not found');
    res.sendFile(
      driver.pathOf(file.key),
      {
        headers: {
          'Content-Type': file.mimeType,
          'Content-Disposition': contentDisposition(file.mimeType, file.filename),
          'X-Content-Type-Options': 'nosniff',
          // Nothing served here may run script; the PDF viewer needs an unsandboxed document.
          ...(file.mimeType === 'application/pdf' ? {} : { 'Content-Security-Policy': "default-src 'none'; sandbox" }),
          'Cache-Control': 'private, max-age=3600',
          'Cross-Origin-Resource-Policy': 'cross-origin',
        },
      },
      (err) => {
        if (err && !res.headersSent) res.status(404).json({ statusCode: 404, message: 'File not found' });
      },
    );
  }
}
