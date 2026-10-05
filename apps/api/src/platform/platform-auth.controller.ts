import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { LoginRateLimiter } from '../auth/login-rate-limit.js';
import { BCRYPT_ROUNDS } from '../auth/school-setup.service.js';
import type { PlatformUser } from '../common/auth-user.js';
import { CurrentAdmin, PlatformOnly, Public } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  AllowPendingPasswordChange,
  PlatformAccessGuard,
} from './platform-access.guard.js';
import { logPlatform } from './platform-audit.js';

const loginSchema = z.object({
  email: z.email().toLowerCase(),
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

/** Sign-in for SchoolSyncer staff, separate from school logins. */
@Controller('platform/auth')
@UseGuards(PlatformAccessGuard)
export class PlatformAuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly limiter: LoginRateLimiter,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: z.infer<typeof loginSchema>,
    @Ip() ip: string,
  ) {
    const limitKey = LoginRateLimiter.key('platform', body.email, ip);
    this.limiter.assertAllowed(limitKey);
    const admin = await this.prisma.platformAdmin.findUnique({
      where: { email: body.email },
    });
    const valid =
      admin?.isActive &&
      (await bcrypt.compare(body.password, admin.passwordHash));
    if (!admin || !valid) {
      this.limiter.recordFailure(limitKey);
      throw new UnauthorizedException('Wrong email or password');
    }
    this.limiter.recordSuccess(limitKey);
    await this.prisma.platformAdmin.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });
    const payload: PlatformUser = {
      sub: admin.id,
      name: admin.name,
      platform: true,
      role: admin.role,
    };
    // Shorter-lived than school sessions: this login reaches every school.
    return {
      accessToken: this.jwt.sign(payload, { expiresIn: '4h' }),
      admin: {
        ...payload,
        email: admin.email,
        mustChangePassword: admin.mustChangePassword,
      },
    };
  }

  /** The signed-in staff member, read fresh so role and the password flag are current. */
  @Get('me')
  @PlatformOnly()
  @AllowPendingPasswordChange()
  async me(@CurrentAdmin() admin: PlatformUser) {
    const row = await this.prisma.platformAdmin.findUniqueOrThrow({
      where: { id: admin.sub },
      select: { email: true, mustChangePassword: true },
    });
    return {
      sub: admin.sub,
      name: admin.name,
      platform: true,
      role: admin.role,
      email: row.email,
      mustChangePassword: row.mustChangePassword,
    };
  }

  @Post('change-password')
  @PlatformOnly()
  @AllowPendingPasswordChange()
  @HttpCode(200)
  async changePassword(
    @CurrentAdmin() admin: PlatformUser,
    @Body(new ZodValidationPipe(changePasswordSchema))
    body: z.infer<typeof changePasswordSchema>,
  ) {
    const row = await this.prisma.platformAdmin.findUniqueOrThrow({
      where: { id: admin.sub },
    });
    if (!(await bcrypt.compare(body.currentPassword, row.passwordHash)))
      throw new BadRequestException('Your current password is not right');
    if (body.newPassword === body.currentPassword)
      throw new BadRequestException(
        'Choose a new password different from the current one',
      );
    await this.prisma.platformAdmin.update({
      where: { id: admin.sub },
      data: {
        passwordHash: await bcrypt.hash(body.newPassword, BCRYPT_ROUNDS),
        mustChangePassword: false,
      },
    });
    await logPlatform(this.prisma, admin, 'staff.change_password', null, {
      staffId: admin.sub,
    });
    return { ok: true };
  }
}
