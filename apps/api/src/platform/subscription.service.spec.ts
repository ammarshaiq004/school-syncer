import { SubscriptionStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import { SubscriptionService } from './subscription.service.js';

function serviceWith(sub: unknown) {
  const prisma = {
    subscription: { findUnique: vi.fn().mockResolvedValue(sub) },
    platformInvoice: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  return {
    service: new SubscriptionService(prisma as unknown as PrismaService),
    prisma,
  };
}

const sub = (featuresAdded: string[], featuresRemoved: string[]) => ({
  status: SubscriptionStatus.ACTIVE,
  trialEndsAt: null,
  featuresAdded,
  featuresRemoved,
  plan: {
    code: 'starter',
    name: 'Starter',
    features: ['fees', 'exams', 'homework'],
    maxStudents: 300,
    maxCampuses: 1,
  },
});

describe('SubscriptionService.forSchool', () => {
  it('applies per-school feature overrides to the plan', async () => {
    const { service } = serviceWith(sub(['transport'], ['homework']));
    const plan = await service.forSchool('s1');
    expect(plan.features).toEqual(['fees', 'exams', 'transport']);
    expect(plan.access).toBe('full');
  });

  it('caches until forgotten', async () => {
    const { service, prisma } = serviceWith(sub([], []));
    await service.forSchool('s1');
    await service.forSchool('s1');
    expect(prisma.subscription.findUnique).toHaveBeenCalledTimes(1);
    service.forget('s1');
    await service.forSchool('s1');
    expect(prisma.subscription.findUnique).toHaveBeenCalledTimes(2);
  });

  it('blocks a school without a subscription', async () => {
    const { service } = serviceWith(null);
    const plan = await service.forSchool('s1');
    expect(plan).toMatchObject({ access: 'blocked', features: [] });
  });
});
