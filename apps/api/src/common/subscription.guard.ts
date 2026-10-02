import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FEATURES, type Feature } from '../platform/plans.js';
import { SubscriptionService } from '../platform/subscription.service.js';
import type { AuthUser } from './auth-user.js';
import {
  ALLOW_READ_ONLY,
  FEATURE,
  IS_PLATFORM,
  IS_PUBLIC,
} from './decorators.js';

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Applies the school's plan: suspended schools are shut out, modules outside
 * the plan are refused, and a read-only school (trial over, bill overdue) can
 * look but not change anything.
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly subscriptions: SubscriptionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets))
      return true;
    if (this.reflector.getAllAndOverride<boolean>(IS_PLATFORM, targets))
      return true;

    const request = context.switchToHttp().getRequest();
    const user: AuthUser = request.user;
    const plan = await this.subscriptions.forSchool(user.schoolId);
    if (plan.access === 'blocked') throw new ForbiddenException(plan.reason);

    const feature = this.reflector.getAllAndOverride<Feature | undefined>(
      FEATURE,
      targets,
    );
    if (feature && !plan.features.includes(feature)) {
      throw new ForbiddenException(
        `${FEATURES[feature]} is not part of the ${plan.planName} plan. Upgrade to use it.`,
      );
    }

    if (
      plan.access === 'read_only' &&
      !READS.has(request.method) &&
      !this.reflector.getAllAndOverride<boolean>(ALLOW_READ_ONLY, targets)
    ) {
      throw new HttpException(
        plan.reason ?? 'Read only',
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
    return true;
  }
}
