import { Body, Controller, Get, HttpCode, Ip, Post } from '@nestjs/common';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Public } from '../common/decorators.js';
import { PermissionService } from '../common/permission.service.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  loginSchema,
  registerSchoolSchema,
  type LoginInput,
  type RegisterSchoolInput,
} from './auth.schemas.js';
import { SubscriptionService } from '../platform/subscription.service.js';
import { AuthService } from './auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly subscriptions: SubscriptionService,
    private readonly permissions: PermissionService,
  ) {}

  @Public()
  @Post('register-school')
  registerSchool(
    @Body(new ZodValidationPipe(registerSchoolSchema)) body: RegisterSchoolInput,
  ) {
    return this.auth.registerSchool(body);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Ip() ip: string,
  ) {
    return this.auth.login(body, ip);
  }

  /** The signed-in user, with what their school's plan allows so the app can hide the rest. */
  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    const [plan, permissions] = await Promise.all([
      this.subscriptions.forSchool(user.schoolId),
      this.permissions.permissionsFor(user),
    ]);
    return {
      ...user,
      // Effective module levels (none | view | manage) so the app hides what the role cannot use.
      permissions,
      // Set on a support session opened from the platform console.
      support: user.support ?? null,
      plan: {
        name: plan.planName,
        status: plan.status,
        trialEndsAt: plan.trialEndsAt,
        features: plan.features,
        access: plan.access,
        reason: plan.reason,
      },
    };
  }
}
