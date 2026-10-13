import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { AuditService } from '../common/audit.service.js';
import { normalizePhone } from '../common/identity.js';
import type { AuthUser } from '../common/auth-user.js';
import { UserStatusService } from '../common/user-status.service.js';
import { SubscriptionService } from '../platform/subscription.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  ChangePasswordInput,
  LoginInput,
  RegisterSchoolInput,
} from './auth.schemas.js';
import { checkNoPassword, LoginRateLimiter } from './login-rate-limit.js';
import { BCRYPT_ROUNDS, SchoolSetupService } from './school-setup.service.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly subscriptions: SubscriptionService,
    private readonly schools: SchoolSetupService,
    private readonly limiter: LoginRateLimiter,
    private readonly userStatus: UserStatusService,
    private readonly audit: AuditService,
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
    // Phones are stored as 03XXXXXXXXX, but parents type +92 300…, 0300-…;
    // the number as typed is tried too, for rows saved before that rule.
    const phones = [...new Set([input.login, normalizePhone(input.login)].filter((p): p is string => !!p))];
    // A student's username (admission number) can equal someone else's phone
    // or email, so every match is tried: email first, then phone, then username.
    const matches = school
      ? await this.prisma.user.findMany({
          where: {
            schoolId: school.id,
            isActive: true,
            // Email and username are stored lowercased.
            OR: [{ email: login }, { phone: { in: phones } }, { username: login }],
          },
          include: { roles: true },
          take: 3,
        })
      : [];
    const rank = (u: (typeof matches)[number]) =>
      u.email === login ? 0 : u.phone && phones.includes(u.phone) ? 1 : 2;
    matches.sort((a, b) => rank(a) - rank(b));
    let user: (typeof matches)[number] | null = null;
    let checked = false;
    for (const candidate of matches) {
      if (!candidate.passwordHash) continue;
      checked = true;
      if (await bcrypt.compare(input.password, candidate.passwordHash)) {
        user = candidate;
        break;
      }
    }
    if (!checked) await checkNoPassword(input.password);
    if (!user) {
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
    const session = this.issueToken(user);
    // The app sends the user to a change-password screen first when set.
    return {
      ...session,
      user: { ...session.user, mustChangePassword: user.mustChangePassword },
    };
  }

  /**
   * Replaces the signed-in user's password. Bumping the token version ends
   * every other session; the caller gets a fresh token for this one.
   */
  async changePassword(user: AuthUser, input: ChangePasswordInput) {
    // A support session acts as the owner but is not them.
    if (user.support) {
      throw new ForbiddenException('A support session cannot change this password');
    }
    const row = await this.prisma.user.findFirst({
      where: { id: user.sub, schoolId: user.schoolId },
      include: { roles: true },
    });
    if (!row?.passwordHash || !(await bcrypt.compare(input.currentPassword, row.passwordHash))) {
      throw new BadRequestException('Your current password is not right');
    }
    if (input.newPassword === input.currentPassword) {
      throw new BadRequestException('Choose a new password different from the current one');
    }
    const updated = await this.prisma.user.update({
      where: { id: row.id },
      data: {
        passwordHash: await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS),
        mustChangePassword: false,
        tokenVersion: { increment: 1 },
      },
      include: { roles: true },
    });
    this.userStatus.forget(row.id);
    await this.audit.record(user, 'user.change_password', 'User', row.id);
    const session = this.issueToken(updated);
    return { ...session, user: { ...session.user, mustChangePassword: false } };
  }

  issueToken(user: {
    id: string;
    schoolId: string;
    name: string;
    tokenVersion: number;
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
      tv: user.tokenVersion,
    };
    return { accessToken: this.jwt.sign(payload), user: payload };
  }
}
