import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import type { AuthUser } from './auth-user.js';
import { ROLES } from './decorators.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;

    const user: AuthUser | undefined = context.switchToHttp().getRequest().user;
    if (user?.roles.some((grant) => required.includes(grant.role))) {
      return true;
    }
    throw new ForbiddenException('Your role cannot do this');
  }
}
