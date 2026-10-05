import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import type { AuthUser } from '../common/auth-user.js';
import { SubscriptionService } from '../platform/subscription.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { LoginInput, RegisterSchoolInput } from './auth.schemas.js';
import { LoginRateLimiter } from './login-rate-limit.js';
import { SchoolSetupService } from './school-setup.service.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly subscriptions: SubscriptionService,
    private readonly schools: SchoolSetupService,
    private readonly limiter: LoginRateLimiter,
  ) {}

  /** Self sign-up: a new school on a free trial, signed straight in. */
  async registerSchool(input: RegisterSchoolInput) {
    const { schoolSlug, owner } = await this.schools.createSchool(input);
    return { schoolSlug, ...this.issueToken(owner) };
  }

  async login(input: LoginInput, ip?: string) {
    const limitKey = LoginRateLimiter.key(
      'school',
      `${input.schoolSlug}/${input.login}`,
      ip,
    );
    this.limiter.assertAllowed(limitKey);
    const school = await this.prisma.school.findUnique({
      where: { slug: input.schoolSlug },
    });
    const login = input.login.toLowerCase();
    const user = school
      ? await this.prisma.user.findFirst({
          where: {
            schoolId: school.id,
            isActive: true,
            OR: [{ email: login }, { phone: input.login }],
          },
          include: { roles: true },
        })
      : null;

    const valid =
      user?.passwordHash &&
      (await bcrypt.compare(input.password, user.passwordHash));
    if (!user || !valid) {
      this.limiter.recordFailure(limitKey);
      throw new UnauthorizedException('Wrong school, login or password');
    }
    this.limiter.recordSuccess(limitKey);
    const plan = await this.subscriptions.forSchool(user.schoolId);
    if (plan.access === 'blocked') throw new ForbiddenException(plan.reason);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    return this.issueToken(user);
  }

  issueToken(user: {
    id: string;
    schoolId: string;
    name: string;
    roles: { role: Role; campusId: string | null; customRoleId?: string | null }[];
  }) {
    const payload: AuthUser = {
      sub: user.id,
      schoolId: user.schoolId,
      name: user.name,
      // customRoleId lets PermissionGuard apply a custom role's matrix; `role`
      // is then the custom role's base role (the @Roles ceiling).
      roles: user.roles.map(({ role, campusId, customRoleId }) => ({
        role,
        campusId,
        customRoleId: customRoleId ?? null,
      })),
    };
    return { accessToken: this.jwt.sign(payload), user: payload };
  }
}
