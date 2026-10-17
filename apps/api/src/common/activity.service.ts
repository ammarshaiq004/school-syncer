import { Injectable, Logger } from '@nestjs/common';
import type { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { RoleGrant } from './auth-user.js';
import { dayStart, localToday } from './dates.js';

const MAX_ENTRIES = 20_000;

/** The distinct base roles of a user's grants, in a stable order. */
export const activityRoles = (grants: RoleGrant[]): Role[] => [...new Set(grants.map((g) => g.role))].sort();

/**
 * Daily active users for the console's pilot health (SCHOOL-150).
 * JwtAuthGuard calls `seen` on every school request; the first request of a
 * user's day writes one UserActivityDay row and later ones are answered from
 * memory, so this costs one write per user per day per API instance.
 */
@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);
  /** userId -> the local day already recorded. */
  private readonly recorded = new Map<string, string>();
  /** Replaceable in tests. */
  today: () => string = localToday;

  constructor(private readonly prisma: PrismaService) {}

  async seen(userId: string, schoolId: string, grants: RoleGrant[]) {
    const day = this.today();
    if (this.recorded.get(userId) === day) return;
    if (this.recorded.size >= MAX_ENTRIES) this.recorded.clear();
    this.recorded.set(userId, day);
    try {
      await this.prisma.userActivityDay.createMany({
        data: [{ userId, schoolId, date: dayStart(day), roles: activityRoles(grants) }],
        skipDuplicates: true,
      });
    } catch (e) {
      // Never fails the request; the next one tries again.
      this.recorded.delete(userId);
      this.logger.warn(`Could not record activity for user ${userId}: ${(e as Error).message}`);
    }
  }
}
