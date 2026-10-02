import { ConflictException, Injectable } from '@nestjs/common';
import { PlatformInvoiceStatus, StudentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { accessFor, isFeature, type Access, type Feature } from './plans.js';

export interface SchoolPlan {
  planCode: string;
  planName: string;
  status: string;
  trialEndsAt: Date | null;
  features: Feature[];
  maxStudents: number | null;
  maxCampuses: number | null;
  access: Access;
  reason: string | null;
}

const CACHE_MS = 30_000;

/**
 * A school's plan and what it may do, looked up on every request, so it is
 * cached briefly. Changes made through the platform console clear the cache.
 */
@Injectable()
export class SubscriptionService {
  private cache = new Map<string, { at: number; plan: SchoolPlan }>();

  constructor(private readonly prisma: PrismaService) {}

  async forSchool(schoolId: string): Promise<SchoolPlan> {
    const hit = this.cache.get(schoolId);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.plan;

    const [sub, oldestUnpaid] = await Promise.all([
      this.prisma.subscription.findUnique({
        where: { schoolId },
        include: { plan: true },
      }),
      this.prisma.platformInvoice.findFirst({
        where: { schoolId, status: PlatformInvoiceStatus.UNPAID },
        orderBy: { dueDate: 'asc' },
        select: { dueDate: true },
      }),
    ]);
    // A school without a subscription row predates plans; treat it as blocked
    // rather than letting it use everything for free.
    const plan: SchoolPlan = sub
      ? {
          planCode: sub.plan.code,
          planName: sub.plan.name,
          status: sub.status,
          trialEndsAt: sub.trialEndsAt,
          features: sub.plan.features.filter(isFeature),
          maxStudents: sub.plan.maxStudents,
          maxCampuses: sub.plan.maxCampuses,
          ...accessFor({
            status: sub.status,
            trialEndsAt: sub.trialEndsAt,
            oldestUnpaidDue: oldestUnpaid?.dueDate ?? null,
          }),
        }
      : {
          planCode: 'none',
          planName: 'No plan',
          status: 'CANCELLED',
          trialEndsAt: null,
          features: [],
          maxStudents: 0,
          maxCampuses: 0,
          access: 'blocked',
          reason:
            'This school has no SchoolSyncer plan. Please contact SchoolSyncer.',
        };
    this.cache.set(schoolId, { at: Date.now(), plan });
    return plan;
  }

  forget(schoolId?: string) {
    if (schoolId) this.cache.delete(schoolId);
    else this.cache.clear();
  }

  /** Refuses to go over the plan's student limit. */
  async assertStudentRoom(schoolId: string, adding: number) {
    const plan = await this.forSchool(schoolId);
    if (plan.maxStudents === null) return;
    const active = await this.prisma.student.count({
      where: { schoolId, status: StudentStatus.ACTIVE },
    });
    if (active + adding > plan.maxStudents) {
      throw new ConflictException(
        `The ${plan.planName} plan allows ${plan.maxStudents} students and the school has ${active}. Upgrade the plan to add ${adding === 1 ? 'more students' : `these ${adding}`}.`,
      );
    }
  }

  async assertCampusRoom(schoolId: string) {
    const plan = await this.forSchool(schoolId);
    if (plan.maxCampuses === null) return;
    const campuses = await this.prisma.campus.count({ where: { schoolId } });
    if (campuses + 1 > plan.maxCampuses) {
      throw new ConflictException(
        `The ${plan.planName} plan allows ${plan.maxCampuses} ${plan.maxCampuses === 1 ? 'campus' : 'campuses'}. Upgrade the plan to add another.`,
      );
    }
  }
}
