import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Feature } from '../platform/plans.js';
import type { AuthUser, PlatformUser } from './auth-user.js';

export const IS_PUBLIC = 'isPublic';
export const ROLES = 'roles';
export const IS_PLATFORM = 'isPlatform';
export const FEATURE = 'feature';
export const ALLOW_READ_ONLY = 'allowReadOnly';

/** Skips the JWT check for a route. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** A SchoolSyncer staff route: only platform tokens get in, never a school's. */
export const PlatformOnly = () => SetMetadata(IS_PLATFORM, true);

/** Needs a plan that includes this module. */
export const RequiresFeature = (feature: Feature) => SetMetadata(FEATURE, feature);

/** Still allowed to change things when the school is read-only (e.g. choosing a plan). */
export const AllowWhenReadOnly = () => SetMetadata(ALLOW_READ_ONLY, true);

/** Limits a route to users holding at least one of these roles. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest().user,
);

export const CurrentAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PlatformUser =>
    ctx.switchToHttp().getRequest().user,
);
