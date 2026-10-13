import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Role, SchoolMode, SubscriptionStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { TRIAL_DAYS, TRIAL_PLAN } from '../platform/plans.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { slugify } from './slug.js';

export const BCRYPT_ROUNDS = 12;

export interface NewSchool {
  schoolName: string;
  city?: string;
  ownerName: string;
  email: string;
  phone?: string;
  password: string;
  /** Set when someone else chose the owner's password (the platform console). */
  mustChangePassword?: boolean;
  /** Defaults to PHYSICAL. */
  mode?: SchoolMode;
  /** Defaults to the trial plan. */
  planCode?: string;
  /** Defaults to TRIAL. */
  status?: typeof SubscriptionStatus.TRIAL | typeof SubscriptionStatus.ACTIVE;
  /** Length of the trial when status is TRIAL; defaults to TRIAL_DAYS. */
  trialDays?: number;
}

/**
 * Creates a school, its first campus, its owner account and its subscription
 * in one transaction. Used by self sign-up and by the platform console.
 */
@Injectable()
export class SchoolSetupService {
  constructor(private readonly prisma: PrismaService) {}

  async createSchool(input: NewSchool) {
    const slug = await this.uniqueSlug(slugify(input.schoolName) || 'school');
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    const status = input.status ?? SubscriptionStatus.TRIAL;
    const planCode = input.planCode ?? TRIAL_PLAN;
    const plan = await this.prisma.plan.findUnique({
      where: { code: planCode },
    });
    if (!plan) throw new BadRequestException('No such plan');
    const owner = await this.prisma.$transaction(async (tx) => {
      const school = await tx.school.create({
        data: {
          name: input.schoolName,
          slug,
          city: input.city,
          email: input.email,
          phone: input.phone,
          mode: input.mode ?? SchoolMode.PHYSICAL,
        },
      });
      await tx.campus.create({
        data: {
          schoolId: school.id,
          name: input.mode === SchoolMode.ONLINE ? 'Online campus' : 'Main campus',
        },
      });
      await tx.subscription.create({
        data: {
          schoolId: school.id,
          planId: plan.id,
          status,
          trialEndsAt:
            status === SubscriptionStatus.TRIAL
              ? new Date(
                  Date.now() + (input.trialDays ?? TRIAL_DAYS) * 86_400_000,
                )
              : null,
        },
      });
      return tx.user.create({
        data: {
          schoolId: school.id,
          name: input.ownerName,
          email: input.email,
          phone: input.phone,
          passwordHash,
          mustChangePassword: input.mustChangePassword ?? false,
          roles: { create: { role: Role.OWNER } },
        },
        include: { roles: true },
      });
    });
    return { schoolSlug: slug, owner };
  }

  private async uniqueSlug(base: string): Promise<string> {
    let slug = base;
    for (
      let n = 2;
      await this.prisma.school.findUnique({ where: { slug } });
      n++
    ) {
      slug = `${base}-${n}`;
      if (n > 50) throw new ConflictException('Could not pick a school slug');
    }
    return slug;
  }
}
