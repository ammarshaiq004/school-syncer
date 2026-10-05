import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUser } from './auth-user.js';
import {
  clean,
  effectivePermissions,
  type AccessLevel,
  type PermissionMatrix,
  type PermissionModule,
  type PermissionOverrides,
} from './permissions.js';

const TTL_MS = 30_000;

/**
 * Loads a school's role matrix edits (BuiltinRolePermission + CustomRole) and
 * turns a signed-in user's grants into effective module levels. The edits are
 * read whole and cached per school for 30 seconds; every write through
 * /roles calls forget(schoolId) so the change applies on the next request.
 * In-memory like SubscriptionService: with several API instances another
 * instance sees a change within the TTL.
 */
@Injectable()
export class PermissionService {
  private cache = new Map<string, { at: number; overrides: Promise<PermissionOverrides> }>();

  constructor(private readonly prisma: PrismaService) {}

  overridesFor(schoolId: string): Promise<PermissionOverrides> {
    const hit = this.cache.get(schoolId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.overrides;
    const overrides = this.load(schoolId);
    this.cache.set(schoolId, { at: Date.now(), overrides });
    // A failed load must not stay cached.
    overrides.catch(() => this.cache.delete(schoolId));
    return overrides;
  }

  forget(schoolId?: string) {
    if (schoolId) this.cache.delete(schoolId);
    else this.cache.clear();
  }

  /** Effective level per module for the user's grants (as carried in the token). */
  async permissionsFor(user: Pick<AuthUser, 'schoolId' | 'roles'>): Promise<PermissionMatrix> {
    const overrides = await this.overridesFor(user.schoolId);
    return effectivePermissions(user.roles ?? [], overrides);
  }

  async levelFor(user: Pick<AuthUser, 'schoolId' | 'roles'>, module: PermissionModule): Promise<AccessLevel> {
    return (await this.permissionsFor(user))[module];
  }

  private async load(schoolId: string): Promise<PermissionOverrides> {
    const [builtins, customs] = await Promise.all([
      this.prisma.builtinRolePermission.findMany({ where: { schoolId } }),
      this.prisma.customRole.findMany({
        where: { schoolId },
        select: { id: true, baseRole: true, permissions: true },
      }),
    ]);
    const overrides: Required<PermissionOverrides> = { builtin: {}, custom: {} };
    for (const row of builtins) overrides.builtin[row.role] = clean(row.permissions);
    for (const row of customs) {
      overrides.custom[row.id] = { baseRole: row.baseRole, permissions: clean(row.permissions) };
    }
    return overrides;
  }
}
