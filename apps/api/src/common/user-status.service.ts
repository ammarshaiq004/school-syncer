import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { RoleGrant } from './auth-user.js';

const TTL_MS = 30_000;
const MAX_ENTRIES = 10_000;

/** A school user's live account state: whether they may sign in, and their current grants. */
export interface UserStatus {
  active: boolean;
  roles: RoleGrant[];
  /** Tokens signed with another version were issued before a password change or reset. */
  tokenVersion: number;
  mustChangePassword: boolean;
}

interface Entry<T> {
  at: number;
  value: Promise<T>;
}

/**
 * The live state behind a school token. School tokens live for hours, so
 * JwtAuthGuard asks here on every request; answers are cached per user for
 * 30 seconds. The guard refuses deactivated users and replaces the grants in
 * the token with the current ones, so a role change or demotion applies
 * without waiting for the token to expire. Every write that changes a user's
 * isActive or role grants calls forget(userId) so this instance applies it at
 * once; other API instances catch up within the TTL. The same goes for a
 * password change or reset, which bumps tokenVersion to end older sessions.
 *
 * Support sessions also check the SchoolSyncer staff member who opened them:
 * once that admin is deactivated the session stops working.
 */
@Injectable()
export class UserStatusService {
  private users = new Map<string, Entry<UserStatus | null>>();
  private admins = new Map<string, Entry<boolean>>();

  constructor(private readonly prisma: PrismaService) {}

  /** null when the user no longer exists in this school. */
  status(userId: string, schoolId: string): Promise<UserStatus | null> {
    return cached(this.users, `${schoolId}/${userId}`, () =>
      this.prisma.user
        .findFirst({
          where: { id: userId, schoolId },
          select: {
            isActive: true,
            tokenVersion: true,
            mustChangePassword: true,
            roles: { select: { role: true, campusId: true, customRoleId: true } },
          },
        })
        .then((u) =>
          u
            ? {
                active: u.isActive,
                roles: u.roles,
                tokenVersion: u.tokenVersion,
                mustChangePassword: u.mustChangePassword,
              }
            : null,
        ),
    );
  }

  async isActive(userId: string, schoolId: string): Promise<boolean> {
    return (await this.status(userId, schoolId))?.active === true;
  }

  /** Whether a platform admin (the issuer of a support session) is still active. */
  adminActive(adminId: string): Promise<boolean> {
    return cached(this.admins, adminId, () =>
      this.prisma.platformAdmin
        .findUnique({ where: { id: adminId }, select: { isActive: true } })
        .then((a) => a?.isActive === true),
    );
  }

  /** Drops cached state for one user (or everyone, including admins, with no id). */
  forget(userId?: string) {
    if (!userId) {
      this.users.clear();
      this.admins.clear();
      return;
    }
    for (const key of this.users.keys()) if (key.endsWith(`/${userId}`)) this.users.delete(key);
  }

  forgetAdmin(adminId: string) {
    this.admins.delete(adminId);
  }
}

function cached<T>(map: Map<string, Entry<T>>, key: string, load: () => Promise<T>): Promise<T> {
  const hit = map.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  if (map.size >= MAX_ENTRIES) map.clear();
  const value = load();
  map.set(key, { at: Date.now(), value });
  // A failed lookup must not stay cached.
  value.catch(() => map.delete(key));
  return value;
}
