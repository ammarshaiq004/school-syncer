import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Feature } from '../platform/plans.js';
import type { AuthUser, PlatformUser } from './auth-user.js';
import type { AccessLevel, PermissionModule } from './permissions.js';

export const IS_PUBLIC = 'isPublic';
export const ROLES = 'roles';
export const IS_PLATFORM = 'isPlatform';
export const FEATURE = 'feature';
export const ALLOW_READ_ONLY = 'allowReadOnly';

/** Skips the JWT check for a route. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** A SchoolSyncer staff route: only platform tokens get in, never a school's. */
export const PlatformOnly = () => SetMetadata(IS_PLATFORM, true);

export const ALLOW_PENDING_PASSWORD = 'allowPendingPasswordChange';

/**
 * Marks the routes a user may call while they still have to replace a
 * password someone else issued (who am I, change password). Every other
 * route answers 403 until they do. Applies to school and console sign-ins.
 */
export const AllowPendingPasswordChange = () => SetMetadata(ALLOW_PENDING_PASSWORD, true);

/** Needs a plan that includes this module. */
export const RequiresFeature = (feature: Feature) => SetMetadata(FEATURE, feature);

/** Still allowed to change things when the school is read-only (e.g. choosing a plan). */
export const AllowWhenReadOnly = () => SetMetadata(ALLOW_READ_ONLY, true);

/** Limits a route to users holding at least one of these roles. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export const PERMISSION = 'permission';

/** What a route needs from the school's permission matrix (see PermissionGuard). */
export interface PermissionRequirement {
  module: PermissionModule;
  /** Omitted: GET/HEAD/OPTIONS need view, every other method needs manage. */
  level?: AccessLevel;
}

/**
 * The permission module a controller (or a single handler) belongs to. Put it
 * on the class so every handler inherits it; a handler-level annotation
 * overrides the class one. Reads need `view`, writes need `manage`, unless an
 * explicit level is given.
 */
export const Permission = (module: PermissionModule, level?: AccessLevel) =>
  SetMetadata(PERMISSION, { module, level } satisfies PermissionRequirement);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest().user,
);

export const CurrentAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PlatformUser =>
    ctx.switchToHttp().getRequest().user,
);
