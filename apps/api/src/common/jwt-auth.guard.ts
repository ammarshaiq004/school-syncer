import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ActivityService } from './activity.service.js';
import type { AuthUser, PlatformUser } from './auth-user.js';
import { ALLOW_PENDING_PASSWORD, IS_PLATFORM, IS_PUBLIC } from './decorators.js';
import { UserStatusService } from './user-status.service.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly users: UserStatusService,
    private readonly activity: ActivityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException();

    let payload: Partial<AuthUser & PlatformUser>;
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException();
    }
    // Platform and school tokens are signed with the same key, so each route
    // only accepts its own kind: a platform token has no school to scope
    // queries by, and a school token must never reach the platform console.
    const platformRoute = this.reflector.getAllAndOverride<boolean>(IS_PLATFORM, [
      context.getHandler(),
      context.getClass(),
    ]);
    const isPlatformToken = payload.platform === true;
    if (Boolean(platformRoute) !== isPlatformToken) throw new UnauthorizedException();
    if (!isPlatformToken) {
      if (typeof payload.schoolId !== 'string' || typeof payload.sub !== 'string') {
        throw new UnauthorizedException();
      }
      // A deactivated (or deleted) user's token stops working within 30 s.
      const status = await this.users.status(payload.sub, payload.schoolId);
      if (!status?.active) {
        throw new UnauthorizedException('This account has been deactivated');
      }
      // A support session ends when the staff member who opened it is deactivated.
      if (payload.support && !(await this.users.adminActive(payload.support.adminId))) {
        throw new UnauthorizedException('This support session has ended');
      }
      // A password change or reset bumps the version, ending older sessions.
      if ((payload.tv ?? 0) !== status.tokenVersion) {
        throw new UnauthorizedException('Your session has ended. Sign in again');
      }
      // A password someone else issued is known to them too: nothing but
      // changing it works until the user has chosen their own. A support
      // session is not the user, so it is not held up by this.
      payload.mustChangePassword = status.mustChangePassword && !payload.support;
      if (
        payload.mustChangePassword &&
        !this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD, [
          context.getHandler(),
          context.getClass(),
        ])
      ) {
        throw new ForbiddenException('Choose a new password before carrying on');
      }
      // Grants come from the database, not the token, so a role change or
      // demotion applies within the cache TTL instead of when the token expires.
      payload.roles = status.roles;
      // Daily active users for the console; a support session is not the user.
      if (!payload.support) await this.activity.seen(payload.sub, payload.schoolId, status.roles);
    }
    request.user = payload;
    return true;
  }
}
