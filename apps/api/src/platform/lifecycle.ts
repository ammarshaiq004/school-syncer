import { PlatformRole, SubscriptionStatus } from '@prisma/client';

export const LIFECYCLE_ACTIONS = ['suspend', 'reactivate', 'cancel'] as const;
export type LifecycleAction = (typeof LIFECYCLE_ACTIONS)[number];

export const isLifecycleAction = (v: string): v is LifecycleAction =>
  (LIFECYCLE_ACTIONS as readonly string[]).includes(v);

/**
 * The status a lifecycle action moves a school to, or an error message when
 * the action makes no sense from where the school is now.
 */
export function lifecycleTarget(
  action: LifecycleAction,
  current: SubscriptionStatus,
): { status: SubscriptionStatus } | { error: string } {
  switch (action) {
    case 'suspend':
      if (
        current === SubscriptionStatus.SUSPENDED ||
        current === SubscriptionStatus.CANCELLED
      )
        return { error: `This school is already ${current.toLowerCase()}` };
      return { status: SubscriptionStatus.SUSPENDED };
    case 'reactivate':
      if (
        current !== SubscriptionStatus.SUSPENDED &&
        current !== SubscriptionStatus.CANCELLED
      )
        return { error: 'Only a suspended or closed school can be reactivated' };
      return { status: SubscriptionStatus.ACTIVE };
    case 'cancel':
      if (current === SubscriptionStatus.CANCELLED)
        return { error: 'This school is already closed' };
      return { status: SubscriptionStatus.CANCELLED };
  }
}

export interface StaffTarget {
  id: string;
  role: PlatformRole;
  isActive: boolean;
}

/**
 * Guards changes to SchoolSyncer staff accounts: nobody locks themselves out
 * or demotes themselves, and there is always at least one active owner.
 * Returns an error message, or null when the change is fine.
 */
export function staffChangeError(
  actorId: string,
  target: StaffTarget,
  change: { role?: PlatformRole; isActive?: boolean },
  activeOwners: number,
): string | null {
  const self = actorId === target.id;
  if (self && change.isActive === false)
    return 'You cannot deactivate your own account';
  if (self && change.role && change.role !== target.role)
    return 'You cannot change your own role';
  const wasActiveOwner = target.isActive && target.role === PlatformRole.OWNER;
  const staysActiveOwner =
    (change.isActive ?? target.isActive) &&
    (change.role ?? target.role) === PlatformRole.OWNER;
  if (wasActiveOwner && !staysActiveOwner && activeOwners <= 1)
    return 'SchoolSyncer needs at least one active owner';
  return null;
}
