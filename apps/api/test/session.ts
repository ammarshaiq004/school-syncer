import type { INestApplication } from '@nestjs/common';
import { UserStatusService } from '../src/common/user-status.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

/**
 * Accounts created by an admin (or a generated student or parent login) must
 * change their password on first sign-in. Suites that are not about that
 * call this after logging in so the issued password keeps working; the
 * forced change itself is covered in password.e2e-spec.ts.
 */
export async function keepIssuedPassword(
  app: INestApplication,
  login: { user: { sub: string; mustChangePassword?: boolean } },
) {
  if (!login.user.mustChangePassword) return;
  await app.get(PrismaService).user.update({
    where: { id: login.user.sub },
    data: { mustChangePassword: false },
  });
  app.get(UserStatusService).forget(login.user.sub);
}
