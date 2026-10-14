import { randomUUID } from 'node:crypto';
import { open, rm } from 'node:fs/promises';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { FilePurpose, Role, type StoredFile } from '@prisma/client';
import { hasAnyRole, STAFF_ROLES } from '../../common/admin-roles.js';
import type { AuthUser } from '../../common/auth-user.js';
import { SubscriptionService } from '../../platform/subscription.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { resolveStudent } from '../../student/student-context.js';
import { TeachingScopeService } from '../assignments/teaching-scope.service.js';
import { CoursesService } from '../courses/courses.service.js';
import {
  checkFile,
  cleanFilename,
  contentDisposition,
  kindOfMime,
  SNIFF_BYTES,
  storageProblem,
  type FileKind,
} from './file-rules.js';
import { STORAGE_DRIVER, type StorageDriver } from './storage/storage-driver.js';

/** How long a download or playback link works. Long enough to watch a lesson video. */
export const LINK_SECONDS = 3 * 60 * 60;
/** Uploads never attached to anything are removed after this long. */
const STALE_UPLOAD_MS = 24 * 60 * 60 * 1000;

/** The temp file multer wrote for one upload. */
export interface UploadedTemp {
  path: string;
  originalname: string;
  size: number;
}

export interface FileView {
  id: string;
  filename: string;
  mimeType: string;
  kind: FileKind | null;
  size: number;
  createdAt: Date;
}

export interface FileLink extends FileView {
  url: string;
  urlExpiresAt: Date;
}

/**
 * E-school uploads: type, size and storage checks on the way in, who may open
 * a file (whoever may see the lesson, assignment or submission it belongs
 * to), short-lived links on the way out, and removing files nothing uses.
 */
@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionService,
    private readonly courses: CoursesService,
    private readonly teaching: TeachingScopeService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  static view(file: StoredFile): FileView {
    const { id, filename, mimeType, size, createdAt } = file;
    return { id, filename, mimeType, kind: kindOfMime(mimeType), size, createdAt };
  }

  /** Checks and stores one upload. The temp file is always removed. */
  async upload(user: AuthUser, purpose: FilePurpose, temp: UploadedTemp | undefined): Promise<FileLink> {
    if (!temp) throw new BadRequestException('Choose a file to upload');
    try {
      const filename = cleanFilename(Buffer.from(temp.originalname, 'latin1').toString('utf8'));
      const check = checkFile(purpose, filename, temp.size, await readHead(temp.path));
      if (!check.ok) throw new BadRequestException(check.problem);
      await this.assertRoom(user.schoolId, temp.size);
      const key = `schools/${user.schoolId}/${purpose.toLowerCase()}/${randomUUID()}.${check.ext}`;
      await this.storage.put(key, temp.path, check.mime);
      const file = await this.prisma.storedFile.create({
        data: {
          schoolId: user.schoolId,
          purpose,
          key,
          filename,
          mimeType: check.mime,
          size: temp.size,
          uploadedById: user.sub,
        },
      });
      return this.link(file);
    } finally {
      await rm(temp.path, { force: true });
    }
  }

  /** The file with a fresh link, when this user may see what it is attached to. */
  async linkFor(user: AuthUser, id: string): Promise<FileLink> {
    return this.link(await this.readable(user, id));
  }

  async link(file: StoredFile): Promise<FileLink> {
    const url = await this.storage.signedUrl(
      file.key,
      { id: file.id, mimeType: file.mimeType, disposition: contentDisposition(file.mimeType, file.filename) },
      LINK_SECONDS,
    );
    return { ...FilesService.view(file), url, urlExpiresAt: new Date(Date.now() + LINK_SECONDS * 1000) };
  }

  /** Links for the files of a list of records, keyed by file id (one storage call each). */
  async links(files: (StoredFile | null | undefined)[]): Promise<Map<string, FileLink>> {
    const present = files.filter((f): f is StoredFile => !!f);
    const links = await Promise.all(present.map((f) => this.link(f)));
    return new Map(links.map((l) => [l.id, l]));
  }

  /**
   * A just-uploaded file this user may attach: same school and purpose,
   * uploaded by them and not attached anywhere yet. `kinds` limits the type
   * (a video lesson needs a video).
   */
  async claim(user: AuthUser, fileId: string, purpose: FilePurpose, kinds?: FileKind[]) {
    const file = await this.prisma.storedFile.findFirst({
      where: { id: fileId, schoolId: user.schoolId, purpose, uploadedById: user.sub },
      include: { lesson: { select: { id: true } }, assignment: { select: { id: true } }, submission: { select: { id: true } } },
    });
    if (!file) throw new BadRequestException('Upload the file again before saving');
    if (file.lesson || file.assignment || file.submission) {
      throw new ConflictException('This file is already attached elsewhere. Upload it again.');
    }
    const kind = kindOfMime(file.mimeType);
    if (kinds && (!kind || !kinds.includes(kind))) {
      throw new BadRequestException(
        kinds.length === 1 && kinds[0] === 'video' ? 'A video lesson needs a video file' : 'This file type does not fit here',
      );
    }
    return file;
  }

  /** Deletes the files no lesson, assignment or submission uses any more. Best effort. */
  async release(ids: (string | null | undefined)[]) {
    const candidates = [...new Set(ids.filter((id): id is string => !!id))];
    if (!candidates.length) return;
    const orphans = await this.prisma.storedFile.findMany({
      where: { id: { in: candidates }, lesson: null, assignment: null, submission: null, studentPhoto: null },
    });
    await this.destroy(orphans);
  }

  /** The uploader removes a file they have not attached yet (a mistaken upload). */
  async removeUnattached(user: AuthUser, id: string) {
    const file = await this.prisma.storedFile.findFirst({
      where: { id, schoolId: user.schoolId, uploadedById: user.sub },
      include: {
        lesson: { select: { id: true } },
        assignment: { select: { id: true } },
        submission: { select: { id: true } },
        studentPhoto: { select: { id: true } },
      },
    });
    if (!file) throw new NotFoundException('File not found');
    if (file.lesson || file.assignment || file.submission || file.studentPhoto) {
      throw new ConflictException('Remove the file from its lesson, assignment or submission instead');
    }
    await this.destroy([file]);
    return { deleted: true };
  }

  async usage(schoolId: string) {
    const [sum, plan] = await Promise.all([
      this.prisma.storedFile.aggregate({ where: { schoolId }, _sum: { size: true }, _count: true }),
      this.subscriptions.forSchool(schoolId),
    ]);
    return {
      usedBytes: sum._sum.size ?? 0,
      files: sum._count,
      limitBytes: plan.maxStorageMb === null ? null : plan.maxStorageMb * 1024 * 1024,
      driver: this.storage.name,
    };
  }

  /** Files of a course, unit or lesson set, collected before a cascade delete removes the rows. */
  async lessonFileIds(where: { courseId?: string; unitId?: string }) {
    const rows = await this.prisma.lesson.findMany({
      where: { fileId: { not: null }, unit: where.courseId ? { courseId: where.courseId } : { id: where.unitId } },
      select: { fileId: true },
    });
    return rows.map((r) => r.fileId);
  }

  private async readable(user: AuthUser, id: string): Promise<StoredFile> {
    const file = await this.prisma.storedFile.findFirst({
      where: { id: id ?? '', schoolId: user.schoolId },
      include: {
        lesson: { select: { id: true } },
        assignment: { select: { id: true } },
        submission: { select: { id: true, assignmentId: true, studentId: true } },
      },
    });
    const notFound = new NotFoundException('File not found');
    if (!file) throw notFound;
    const { lesson, assignment, submission, ...row } = file;
    if (!lesson && !assignment && !submission) {
      if (file.uploadedById !== user.sub) throw notFound;
      return row;
    }
    if (hasAnyRole(user, STAFF_ROLES)) {
      if (lesson) await this.courses.lessonInScope(user, lesson.id);
      const assignmentId = assignment?.id ?? submission?.assignmentId;
      if (assignmentId) {
        const visible = await this.prisma.assignment.count({
          where: { AND: [{ id: assignmentId }, await this.teaching.where(user)] },
        });
        if (!visible) throw notFound;
      }
      return row;
    }
    if (!hasAnyRole(user, [Role.STUDENT])) throw notFound;
    const me = await resolveStudent(this.prisma, user);
    const section = me.sectionId ?? '';
    let visible = false;
    if (lesson) {
      visible = !!(await this.prisma.lesson.count({
        where: {
          id: lesson.id,
          isPublished: true,
          unit: { course: { schoolId: user.schoolId, sectionId: section, isPublished: true } },
        },
      }));
    } else if (assignment) {
      visible = !!(await this.prisma.assignment.count({
        where: { id: assignment.id, schoolId: user.schoolId, sectionId: section, isPublished: true },
      }));
    } else if (submission) {
      visible = submission.studentId === me.id;
    }
    if (!visible) throw notFound;
    return row;
  }

  /** Throws 409 when the school's storage cannot take this many more bytes, after clearing stale uploads. */
  async assertRoom(schoolId: string, adding: number) {
    await this.removeStale(schoolId);
    const { usedBytes } = await this.usage(schoolId);
    const plan = await this.subscriptions.forSchool(schoolId);
    const problem = storageProblem(usedBytes, adding, plan.maxStorageMb);
    if (problem) throw new ConflictException(problem);
  }

  /** The school's uploads that were never attached and are over a day old (checked on each new upload). */
  private async removeStale(schoolId: string) {
    const stale = await this.prisma.storedFile.findMany({
      where: {
        schoolId,
        createdAt: { lt: new Date(Date.now() - STALE_UPLOAD_MS) },
        lesson: null,
        assignment: null,
        submission: null,
        studentPhoto: null,
      },
      take: 50,
    });
    await this.destroy(stale);
  }

  private async destroy(files: StoredFile[]) {
    for (const file of files) {
      try {
        await this.storage.delete(file.key);
        await this.prisma.storedFile.deleteMany({ where: { id: file.id } });
      } catch (e) {
        // Left in place; the next release of this file tries again.
        this.logger.warn(`Could not delete file ${file.id}: ${(e as Error).message}`);
      }
    }
  }
}

async function readHead(path: string): Promise<Buffer> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(SNIFF_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, SNIFF_BYTES, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
