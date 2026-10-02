import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import type { AuthUser } from '../common/auth-user.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { LoginInput, RegisterSchoolInput } from './auth.schemas.js';
import { slugify } from './slug.js';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /** Creates a school, its first campus and its owner account in one transaction. */
  async registerSchool(input: RegisterSchoolInput) {
    const slug = await this.uniqueSlug(slugify(input.schoolName) || 'school');
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

    const owner = await this.prisma.$transaction(async (tx) => {
      const school = await tx.school.create({
        data: {
          name: input.schoolName,
          slug,
          city: input.city,
          email: input.email,
          phone: input.phone,
        },
      });
      await tx.campus.create({
        data: { schoolId: school.id, name: 'Main campus' },
      });
      return tx.user.create({
        data: {
          schoolId: school.id,
          name: input.ownerName,
          email: input.email,
          phone: input.phone,
          passwordHash,
          roles: { create: { role: Role.OWNER } },
        },
        include: { roles: true },
      });
    });

    return { schoolSlug: slug, ...this.issueToken(owner) };
  }

  async login(input: LoginInput) {
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
      throw new UnauthorizedException('Wrong school, login or password');
    }

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
    roles: { role: Role; campusId: string | null }[];
  }) {
    const payload: AuthUser = {
      sub: user.id,
      schoolId: user.schoolId,
      name: user.name,
      roles: user.roles.map(({ role, campusId }) => ({ role, campusId })),
    };
    return { accessToken: this.jwt.sign(payload), user: payload };
  }

  private async uniqueSlug(base: string): Promise<string> {
    let slug = base;
    for (let n = 2; await this.prisma.school.findUnique({ where: { slug } }); n++) {
      slug = `${base}-${n}`;
      if (n > 50) throw new ConflictException('Could not pick a school slug');
    }
    return slug;
  }
}
