import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Public } from '../common/decorators.js';
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
  login(@Body(new ZodValidationPipe(loginSchema)) body: LoginInput) {
    return this.auth.login(body);
  }

  /** The signed-in user, with what their school's plan allows so the app can hide the rest. */
  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    const plan = await this.subscriptions.forSchool(user.schoolId);
    return {
      ...user,
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
