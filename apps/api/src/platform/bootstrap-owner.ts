import { PlatformRole, type PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { newPasswordSchema } from '../auth/auth.schemas.js';
import { BCRYPT_ROUNDS } from '../auth/school-setup.service.js';
import { temporaryPassword } from './temp-password.js';

export interface NewPlatformOwner {
  email: string;
  name: string;
  /** Omit to have a strong one generated. Either way it must be changed on first sign-in. */
  password?: string;
  /**
   * Allows a second owner, and recovers an existing account with this email
   * (made an active owner with the new password; its open sessions end).
   */
  force?: boolean;
}

export class BootstrapError extends Error {}

/**
 * Creates the first SchoolSyncer owner for the platform console: the one
 * account no one else can create. Refuses when an active owner exists unless
 * forced. Returns the password so the caller can show it once.
 */
export async function createPlatformOwner(prisma: PrismaClient, input: NewPlatformOwner) {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BootstrapError(`Not an email address: ${input.email}`);
  if (name.length < 2) throw new BootstrapError('Give the owner a name (at least 2 characters)');
  if (input.password !== undefined) {
    const check = newPasswordSchema.safeParse(input.password);
    if (!check.success) throw new BootstrapError(`Password: ${check.error.issues[0].message}`);
  }

  const owners = await prisma.platformAdmin.count({ where: { role: PlatformRole.OWNER, isActive: true } });
  if (owners > 0 && !input.force) {
    throw new BootstrapError(
      `${owners} active console owner(s) already exist; add staff from the console, or pass --force`,
    );
  }
  const existing = await prisma.platformAdmin.findUnique({ where: { email } });
  if (existing && !input.force) {
    throw new BootstrapError(`${email} already has a console account; pass --force to make it an owner with a new password`);
  }

  const password = input.password ?? temporaryPassword(16);
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const admin = existing
    ? await prisma.platformAdmin.update({
        where: { id: existing.id },
        data: {
          name,
          passwordHash,
          role: PlatformRole.OWNER,
          isActive: true,
          mustChangePassword: true,
          tokenVersion: { increment: 1 },
        },
      })
    : await prisma.platformAdmin.create({
        data: { email, name, passwordHash, role: PlatformRole.OWNER, mustChangePassword: true },
      });
  await prisma.platformAuditLog.create({
    data: {
      adminId: admin.id,
      action: existing ? 'staff.bootstrap_recover' : 'staff.bootstrap_owner',
      details: { email, via: 'command line' },
    },
  });
  return { admin, password, recovered: Boolean(existing) };
}
