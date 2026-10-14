import { createHmac, timingSafeEqual } from 'node:crypto';
import { rm } from 'node:fs/promises';
import {
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FilePurpose } from '@prisma/client';
import type { Response } from 'express';
import { adminScope, SETUP_ROLES } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Permission, Public, Roles } from '../common/decorators.js';
import { FilesService, type UploadedTemp } from '../elearning/files/files.service.js';
import { LocalStorageDriver } from '../elearning/files/storage/local.driver.js';
import { STORAGE_DRIVER, type StorageDriver } from '../elearning/files/storage/storage-driver.js';
import { UploadInterceptor } from '../elearning/files/upload.interceptor.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Student photos (SCHOOL-139), for the profile, avatars and ID cards. Stored
 * with the e-school files (same type, size and storage checks), but opened
 * through a link that does not expire, so Student.photoUrl can be used as an
 * <img src> everywhere. The link carries an HMAC of the file id: it cannot
 * be guessed, and replacing or removing the photo deletes the file, which
 * ends the old link.
 */
@Injectable()
export class StudentPhotoLinks {
  private readonly secret: string;
  private readonly publicApiUrl: string;

  constructor(config: ConfigService) {
    this.secret = `student-photo:${config.get<string>('FILE_SIGNING_SECRET') || config.getOrThrow<string>('JWT_SECRET')}`;
    const port = config.get<string>('PORT') || '4000';
    this.publicApiUrl = (config.get<string>('API_PUBLIC_URL') || `http://localhost:${port}`).replace(/\/+$/, '');
  }

  url(fileId: string): string {
    return `${this.publicApiUrl}/api/student-photos/${encodeURIComponent(fileId)}?sig=${this.sign(fileId)}`;
  }

  verify(fileId: string, sig: string | undefined): boolean {
    if (!sig) return false;
    const expected = Buffer.from(this.sign(fileId));
    const given = Buffer.from(sig);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  private sign(fileId: string) {
    return createHmac('sha256', this.secret).update(fileId).digest('base64url');
  }
}

const photoUpload = UploadInterceptor(() => [FilePurpose.STUDENT_PHOTO]);

@Controller('students')
@Permission('students')
@Roles(...SETUP_ROLES)
export class StudentPhotoController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly links: StudentPhotoLinks,
  ) {}

  /** Uploads (or replaces) a student's photo: png, jpg, webp or gif up to 5 MB. */
  @Post(':id/photo')
  @UseInterceptors(photoUpload)
  async upload(@CurrentUser() user: AuthUser, @Param('id') id: string, @UploadedFile() temp?: UploadedTemp) {
    let student;
    try {
      student = await this.findInScope(user, id);
    } catch (e) {
      if (temp) await rm(temp.path, { force: true });
      throw e;
    }
    const file = await this.files.upload(user, FilePurpose.STUDENT_PHOTO, temp);
    const photoUrl = this.links.url(file.id);
    await this.prisma.student.update({ where: { id }, data: { photoFileId: file.id, photoUrl } });
    await this.files.release([student.photoFileId]);
    await this.audit.record(user, 'student.photo', 'Student', id, {
      before: { photoFileId: student.photoFileId },
      after: { photoFileId: file.id },
    });
    return { photoUrl };
  }

  @Delete(':id/photo')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const student = await this.findInScope(user, id);
    await this.prisma.student.update({ where: { id }, data: { photoFileId: null, photoUrl: null } });
    await this.files.release([student.photoFileId]);
    await this.audit.record(user, 'student.photo.remove', 'Student', id, {
      before: { photoFileId: student.photoFileId },
    });
    return { photoUrl: null };
  }

  private async findInScope(user: AuthUser, id: string) {
    const student = await this.prisma.student.findFirst({
      where: { id, schoolId: user.schoolId },
      select: { id: true, campusId: true, photoFileId: true },
    });
    if (!student) throw new NotFoundException('Student not found');
    const scope = adminScope(user);
    if (scope && !scope.includes(student.campusId)) {
      throw new ForbiddenException('Student is at another campus');
    }
    return student;
  }
}

/** Serves a photo from its signed link (an <img> sends no token). */
@Controller('student-photos')
export class StudentPhotoContentController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly links: StudentPhotoLinks,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  @Get(':fileId')
  @Public()
  async content(@Param('fileId') fileId: string, @Query('sig') sig: string | undefined, @Res() res: Response) {
    const notFound = new NotFoundException('Photo not found');
    if (!this.links.verify(fileId, sig)) throw notFound;
    const file = await this.prisma.storedFile.findFirst({
      where: { id: fileId, purpose: FilePurpose.STUDENT_PHOTO, studentPhoto: { isNot: null } },
    });
    if (!file) throw notFound;
    const driver = this.storage;
    if (!(driver instanceof LocalStorageDriver)) {
      // S3: a short-lived bucket link; the browser follows it.
      const url = await driver.signedUrl(
        file.key,
        { id: file.id, mimeType: file.mimeType, disposition: 'inline' },
        10 * 60,
      );
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.redirect(302, url);
      return;
    }
    res.sendFile(
      driver.pathOf(file.key),
      {
        headers: {
          'Content-Type': file.mimeType,
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; sandbox",
          'Cache-Control': 'private, max-age=3600',
          // Shown on the web app's pages, another origin.
          'Cross-Origin-Resource-Policy': 'cross-origin',
        },
      },
      (err) => {
        if (err && !res.headersSent) res.status(404).json({ statusCode: 404, message: 'Photo not found' });
      },
    );
  }
}
