import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUser } from './auth-user.js';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Records who changed what; before/after are stored as JSON snapshots. */
  async record(
    user: AuthUser,
    action: string,
    entity: string,
    entityId: string | null,
    change: { before?: unknown; after?: unknown } = {},
  ) {
    await this.prisma.auditLog.create({
      data: {
        schoolId: user.schoolId,
        userId: user.sub,
        action,
        entity,
        entityId,
        before: (change.before ?? undefined) as Prisma.InputJsonValue,
        after: (change.after ?? undefined) as Prisma.InputJsonValue,
      },
    });
  }
}
