import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { PlatformUser } from '../common/auth-user.js';
import { CurrentAdmin, PlatformOnly, Public } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';

const loginSchema = z.object({
  email: z.email().toLowerCase(),
  password: z.string().min(1),
});

/** Sign-in for SchoolSyncer staff, separate from school logins. */
@Controller('platform/auth')
export class PlatformAuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: z.infer<typeof loginSchema>,
  ) {
    const admin = await this.prisma.platformAdmin.findUnique({
      where: { email: body.email },
    });
    const valid =
      admin?.isActive &&
      (await bcrypt.compare(body.password, admin.passwordHash));
    if (!admin || !valid)
      throw new UnauthorizedException('Wrong email or password');
    await this.prisma.platformAdmin.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });
    const payload: PlatformUser = {
      sub: admin.id,
      name: admin.name,
      platform: true,
    };
    // Shorter-lived than school sessions: this login reaches every school.
    return {
      accessToken: this.jwt.sign(payload, { expiresIn: '4h' }),
      admin: payload,
    };
  }

  @Get('me')
  @PlatformOnly()
  me(@CurrentAdmin() admin: PlatformUser) {
    return admin;
  }
}
