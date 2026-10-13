import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlatformRole } from '@prisma/client';
import type { PlatformUser } from '../common/auth-user.js';
import { ALLOW_PENDING_PASSWORD } from '../common/decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const PLATFORM_OWNER_ONLY = 'platformOwnerOnly';

/**
 * Limits a console route to SchoolSyncer owners (plans, platform staff,
 * feature overrides, closing a school). Needs PlatformAccessGuard on the
 * controller.
 */
export const PlatformOwnerOnly = () => SetMetadata(PLATFORM_OWNER_ONLY, true);

// Shared with school sign-ins: who am I and change password stay open while
// a temporary password is pending.
export { AllowPendingPasswordChange } from '../common/decorators.js';

/**
 * Runs after the global JWT guard on every console controller. Platform
 * tokens live for hours, so the account is re-read on each request: a
 * deactivated staff member is shut out at once and owner-only routes check
 * the current role rather than the one in the token.
 */
@Injectable()
export class PlatformAccessGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user as PlatformUser | undefined;
    // Public routes (sign-in) have no user; the JWT guard already decided.
    if (!user?.platform) return true;
    const admin = await this.prisma.platformAdmin.findUnique({
      where: { id: user.sub },
      select: {
        isActive: true,
        role: true,
        name: true,
        mustChangePassword: true,
        tokenVersion: true,
      },
    });
    if (!admin?.isActive) throw new UnauthorizedException();
    // A password change or reset bumps the version, ending older sessions.
    if ((user.tv ?? 0) !== admin.tokenVersion) {
      throw new UnauthorizedException('Your session has ended. Sign in again');
    }
    request.user = { ...user, role: admin.role, name: admin.name };
    // A temporary password is also known to whoever created it: nothing but
    // changing it works until the staff member has chosen their own.
    if (
      admin.mustChangePassword &&
      !this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      throw new ForbiddenException(
        'Choose a new password before using the console',
      );
    }
    const ownerOnly = this.reflector.getAllAndOverride<boolean>(
      PLATFORM_OWNER_ONLY,
      [context.getHandler(), context.getClass()],
    );
    if (ownerOnly && admin.role !== PlatformRole.OWNER) {
      throw new ForbiddenException(
        'Only a SchoolSyncer owner can do this',
      );
    }
    return true;
  }
}
