import { tmpdir } from 'node:os';
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  mixin,
  type NestInterceptor,
  PayloadTooLargeException,
  type Type,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { FilePurpose } from '@prisma/client';
import type { Request } from 'express';
import type { AuthUser } from '../../common/auth-user.js';
import { formatBytes, LIMITS } from './file-rules.js';
import { FilesService } from './files.service.js';

/** Room for the multipart boundaries, headers and form fields around the file. */
export const MULTIPART_OVERHEAD = 64 * 1024;

/** The largest file any of these purposes accepts. */
export function largestFile(purposes: FilePurpose[]): number {
  return Math.max(...purposes.flatMap((p) => Object.values(LIMITS[p])));
}

/**
 * Accepts one upload in the "file" field, refusing it before anything is
 * written when the request is bigger than the route's purpose allows or than
 * the school's storage has room for. Multer then writes to a temp file (never
 * memory) and stops at the same size, for requests that do not say their
 * length up front. The exact type, size and storage checks follow in
 * FilesService.upload.
 */
export function UploadInterceptor(purposesOf: (req: Request) => FilePurpose[]): Type<NestInterceptor> {
  @Injectable()
  class Upload implements NestInterceptor {
    private readonly multers = new Map<number, NestInterceptor>();

    constructor(private readonly files: FilesService) {}

    async intercept(context: ExecutionContext, next: CallHandler) {
      const req = context.switchToHttp().getRequest<Request & { user: AuthUser }>();
      const maxBytes = largestFile(purposesOf(req));
      const declared = Number(req.headers['content-length']) || 0;
      if (declared > maxBytes + MULTIPART_OVERHEAD) {
        throw new PayloadTooLargeException(`This file is too big. Files here can be up to ${formatBytes(maxBytes)}.`);
      }
      if (declared > MULTIPART_OVERHEAD) await this.files.assertRoom(req.user.schoolId, declared - MULTIPART_OVERHEAD);
      return this.multer(maxBytes).intercept(context, next);
    }

    private multer(maxBytes: number) {
      let interceptor = this.multers.get(maxBytes);
      if (!interceptor) {
        const Multer = FileInterceptor('file', { dest: tmpdir(), limits: { fileSize: maxBytes, files: 1, fields: 5 } });
        interceptor = new Multer();
        this.multers.set(maxBytes, interceptor);
      }
      return interceptor;
    }
  }
  return mixin(Upload);
}
