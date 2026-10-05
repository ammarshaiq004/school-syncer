import { Prisma } from '@prisma/client';
import type { PlatformUser } from '../common/auth-user.js';
import type { PrismaService } from '../prisma/prisma.service.js';

/** Writes one entry to the console's own audit log. */
export function logPlatform(
  prisma: PrismaService | Prisma.TransactionClient,
  admin: PlatformUser,
  action: string,
  schoolId: string | null,
  details: unknown,
) {
  return prisma.platformAuditLog.create({
    data: {
      adminId: admin.sub,
      action,
      schoolId,
      details: details as Prisma.InputJsonValue,
    },
  });
}

/**
 * Records a console action in the school's own audit log too, so the school
 * can see what SchoolSyncer staff changed. userId is null: the actor is not a
 * school user; `after.by` names the staff member.
 */
export function logToSchool(
  prisma: PrismaService | Prisma.TransactionClient,
  admin: PlatformUser,
  schoolId: string,
  action: string,
  entity: string,
  entityId: string | null,
  change: { before?: unknown; after?: unknown } = {},
) {
  return prisma.auditLog.create({
    data: {
      schoolId,
      userId: null,
      action,
      entity,
      entityId,
      before: (change.before ?? undefined) as Prisma.InputJsonValue,
      after: {
        ...(change.after as object | undefined),
        by: admin.name,
        byAdminId: admin.sub,
      } as Prisma.InputJsonValue,
    },
  });
}
