import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUser } from './auth-user.js';

export interface AuditEntry {
  action: string;
  entity: string;
  entityId: string | null;
  before?: unknown;
  after?: unknown;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records who changed what; before/after are stored as JSON snapshots.
   * Pass `db` to write it inside the caller's transaction, so the record
   * exists exactly when the change does.
   */
  async record(
    user: AuthUser,
    action: string,
    entity: string,
    entityId: string | null,
    change: { before?: unknown; after?: unknown } = {},
    db: Prisma.TransactionClient = this.prisma,
  ) {
    await db.auditLog.create({ data: this.row(user, { action, entity, entityId, ...change }) });
  }

  /** Several records in one insert, e.g. one per changed mark on a sheet. */
  async recordMany(user: AuthUser, entries: AuditEntry[], db: Prisma.TransactionClient = this.prisma) {
    if (!entries.length) return;
    await db.auditLog.createMany({ data: entries.map((e) => this.row(user, e)) });
  }

  private row(user: AuthUser, e: AuditEntry): Prisma.AuditLogCreateManyInput {
    return {
      schoolId: user.schoolId,
      userId: user.sub,
      action: e.action,
      entity: e.entity,
      entityId: e.entityId,
      before: (e.before ?? undefined) as Prisma.InputJsonValue,
      after: (e.after ?? undefined) as Prisma.InputJsonValue,
      // A support session acts as the owner; record which SchoolSyncer staff member it really was.
      support: user.support
        ? { adminId: user.support.adminId, adminName: user.support.adminName }
        : undefined,
    };
  }
}
