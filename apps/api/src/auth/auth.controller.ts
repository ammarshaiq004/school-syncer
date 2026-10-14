import { Body, Controller, Get, HttpCode, Ip, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthUser } from '../common/auth-user.js';
import {
  AllowPendingPasswordChange,
  AllowWhenReadOnly,
  CurrentUser,
  Public,
} from '../common/decorators.js';
import { PermissionService } from '../common/permission.service.js';
import { RateLimit } from '../common/rate-limit.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchoolSchema,
  resetPasswordSchema,
  type ChangePasswordInput,
  type ForgotPasswordInput,
  type LoginInput,
  type RegisterSchoolInput,
  type ResetPasswordInput,
} from './auth.schemas.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SubscriptionService } from '../platform/subscription.service.js';
import { AuthService } from './auth.service.js';
import { PasswordResetService, RESET_PER_IP } from './password-reset.service.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly subscriptions: SubscriptionService,
    private readonly permissions: PermissionService,
    private readonly prisma: PrismaService,
    private readonly passwordReset: PasswordResetService,
  ) {}

  @Public()
  @Post('register-school')
  // A few schools per address an hour; more is a script, not a person.
  @RateLimit('sign-up', 10, 60 * 60_000)
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

  /**
   * Forgot password, step 1: texts a 6-digit code to the phone on the
   * account. Answers "sent" whether or not the number has an account, or
   * "unavailable" when the school has no way to send messages.
   */
  @Public()
  @Post('forgot-password')
  @HttpCode(200)
  @RateLimit('forgot-password', RESET_PER_IP, 60 * 60_000)
  forgotPassword(@Body(new ZodValidationPipe(forgotPasswordSchema)) body: ForgotPasswordInput) {
    return this.passwordReset.request(body);
  }

  /** Forgot password, step 2: the code and a new password. Ends every session of the account. */
  @Public()
  @Post('reset-password')
  @HttpCode(200)
  @RateLimit('reset-password', 30, 15 * 60_000)
  resetPassword(@Body(new ZodValidationPipe(resetPasswordSchema)) body: ResetPasswordInput) {
    return this.passwordReset.reset(body);
  }

  /** Replaces the user's own password and ends their other sessions; returns a new token. */
  @Post('change-password')
  @AllowPendingPasswordChange()
  @AllowWhenReadOnly()
  @HttpCode(200)
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordInput,
  ) {
    return this.auth.changePassword(user, body);
  }

  /** The signed-in user, with what their school's plan allows so the app can hide the rest. */
  @Get('me')
  @AllowPendingPasswordChange()
  async me(@CurrentUser() user: AuthUser) {
    const [plan, permissions, school, student] = await Promise.all([
      this.subscriptions.forSchool(user.schoolId),
      this.permissions.permissionsFor(user),
      this.prisma.school.findUniqueOrThrow({
        where: { id: user.schoolId },
        select: { id: true, name: true, slug: true, mode: true, logoUrl: true },
      }),
      user.roles.some((r) => r.role === Role.STUDENT)
        ? this.prisma.student.findFirst({
            where: { userId: user.sub, schoolId: user.schoolId },
            select: { id: true },
          })
        : null,
    ]);
    return {
      ...user,
      // The school's mode (PHYSICAL | ONLINE | HYBRID) decides which modules the app shows.
      school,
      // The student record behind a STUDENT login, so the student workspace can link to it.
      studentId: student?.id ?? null,
      // Effective module levels (none | view | manage) so the app hides what the role cannot use.
      permissions,
      // Set on a support session opened from the platform console.
      support: user.support ?? null,
      // The app shows only the change-password screen until this is false.
      mustChangePassword: user.mustChangePassword ?? false,
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
