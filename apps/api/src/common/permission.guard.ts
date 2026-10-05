import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthUser } from './auth-user.js';
import {
  IS_PLATFORM,
  IS_PUBLIC,
  PERMISSION,
  type PermissionRequirement,
} from './decorators.js';
import { PermissionService } from './permission.service.js';
import {
  moduleLabel,
  satisfies,
  type AccessLevel,
  type PermissionModule,
} from './permissions.js';

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The level a request needs: the explicit one, else view for reads and manage for writes. */
export function requiredLevel(requirement: PermissionRequirement, method: string): AccessLevel {
  return requirement.level ?? (READS.has(method.toUpperCase()) ? 'view' : 'manage');
}

/** The 403 text shown to the user (the web shows it as is). */
export function deniedMessage(module: PermissionModule, have: AccessLevel): string {
  const label = moduleLabel(module);
  return have === 'view'
    ? `Your role can view ${label} but cannot change it`
    : `Your role does not have access to ${label}`;
}

/**
 * The school's permission matrix, applied after RolesGuard (the ceiling) and
 * SubscriptionGuard (the plan). Routes opt in with @Permission(module); routes
 * without it, public routes and platform routes pass through untouched.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(IS_PLATFORM, targets)) return true;
    const requirement = this.reflector.getAllAndOverride<PermissionRequirement | undefined>(
      PERMISSION,
      targets,
    );
    if (!requirement) return true;

    const request = context.switchToHttp().getRequest();
    const user: AuthUser | undefined = request.user;
    if (!user?.schoolId) throw new ForbiddenException('Your role cannot do this');

    const need = requiredLevel(requirement, request.method);
    const have = await this.permissions.levelFor(user, requirement.module);
    if (satisfies(have, need)) return true;
    throw new ForbiddenException(deniedMessage(requirement.module, have));
  }
}
