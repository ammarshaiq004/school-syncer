import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { AuthUser, PlatformUser } from './auth-user.js';
import { IS_PLATFORM, IS_PUBLIC } from './decorators.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
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
    if (!isPlatformToken && typeof payload.schoolId !== 'string') throw new UnauthorizedException();
    request.user = payload;
    return true;
  }
}
