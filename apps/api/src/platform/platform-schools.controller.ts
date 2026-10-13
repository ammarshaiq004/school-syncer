import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { PlatformRole, Prisma, Role, SubscriptionStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { phoneField } from '../common/identity.js';
import {
  BCRYPT_ROUNDS,
  SchoolSetupService,
} from '../auth/school-setup.service.js';
import { STAFF_ROLES } from '../common/admin-roles.js';
import type { PlatformUser } from '../common/auth-user.js';
import { CurrentAdmin, PlatformOnly } from '../common/decorators.js';
import { serializable } from '../common/serializable.js';
import { UserStatusService } from '../common/user-status.service.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { lifecycleTarget, type LifecycleAction } from './lifecycle.js';
import { PlatformAccessGuard, PlatformOwnerOnly } from './platform-access.guard.js';
import { logPlatform, logToSchool } from './platform-audit.js';
import { effectiveFeatures, isFeature, TRIAL_DAYS } from './plans.js';
import { SubscriptionService } from './subscription.service.js';
import { temporaryPassword } from './temp-password.js';

const createSchoolSchema = z.object({
  schoolName: z.string().trim().min(2).max(120),
  city: z.string().trim().max(80).optional(),
  ownerName: z.string().trim().min(2).max(120),
  email: z.email().toLowerCase(),
  phone: z.string().trim().max(20).optional(),
  planCode: z.string().trim().min(1),
  status: z
    .enum([SubscriptionStatus.TRIAL, SubscriptionStatus.ACTIVE])
    .default(SubscriptionStatus.TRIAL),
  trialDays: z.number().int().min(1).max(365).optional(),
});

const reasonSchema = z.object({ reason: z.string().trim().min(5).max(500) });
// Optional for now: logged when the console sends one.
const optionalReasonSchema = z
  .object({ reason: z.string().trim().min(5).max(500).optional() })
  .default({});

const grantSchema = z.object({
  role: z.enum(Role).optional(),
  campusId: z.string().nullable().default(null),
  customRoleId: z.string().nullable().default(null),
});
type GrantInput = z.infer<typeof grantSchema>;

const createUserSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    email: z.email().toLowerCase().optional(),
    phone: phoneField.optional(),
    roles: z.array(grantSchema).min(1),
  })
  .refine((u) => u.email || u.phone, {
    message: 'Give an email or a phone number',
    path: ['email'],
  });

const updateUserSchema = z
  .object({
    isActive: z.boolean().optional(),
    roles: z.array(grantSchema).min(1).optional(),
  })
  .refine((b) => b.isActive !== undefined || b.roles, 'Nothing to change');

const featureList = z
  .array(z.string().refine(isFeature, 'Unknown feature'))
  .transform((l) => [...new Set(l)]);
const featuresSchema = z
  .object({ added: featureList, removed: featureList })
  .refine((b) => !b.added.some((f) => b.removed.includes(f)), {
    message: 'A module cannot be both added and removed',
  });

const userSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  roles: {
    select: {
      role: true,
      campusId: true,
      customRoleId: true,
      campus: { select: { name: true } },
      customRole: { select: { name: true } },
    },
  },
} satisfies Prisma.UserSelect;

/**
 * Console actions on one school beyond its plan: creating it, suspending or
 * closing it, its people, and per-school module overrides.
 */
@Controller('platform/schools')
@PlatformOnly()
@UseGuards(PlatformAccessGuard)
export class PlatformSchoolsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly setup: SchoolSetupService,
    private readonly subscriptions: SubscriptionService,
    private readonly userStatus: UserStatusService,
  ) {}

  /** Sets a school up for a customer; the owner's temporary password is returned once. */
  @Post()
  async create(
    @CurrentAdmin() admin: PlatformUser,
    @Body(new ZodValidationPipe(createSchoolSchema))
    body: z.infer<typeof createSchoolSchema>,
  ) {
    const password = temporaryPassword();
    const { schoolSlug, owner } = await this.setup.createSchool({
      ...body,
      password,
      mustChangePassword: true,
      trialDays: body.trialDays ?? TRIAL_DAYS,
    });
    await logPlatform(this.prisma, admin, 'school.create', owner.schoolId, {
      name: body.schoolName,
      plan: body.planCode,
      status: body.status,
    });
    await logToSchool(
      this.prisma,
      admin,
      owner.schoolId,
      'platform.school_create',
      'School',
      owner.schoolId,
      { after: { plan: body.planCode, status: body.status } },
    );
    return {
      schoolId: owner.schoolId,
      schoolSlug,
      owner: { id: owner.id, name: owner.name, email: owner.email },
      temporaryPassword: password,
    };
  }

  // ----- Lifecycle -----

  @Post(':id/suspend')
  @HttpCode(200)
  suspend(
    @CurrentAdmin() admin: PlatformUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reasonSchema)) body: { reason: string },
  ) {
    return this.lifecycle(admin, id, 'suspend', body.reason);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  reactivate(
    @CurrentAdmin() admin: PlatformUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reasonSchema)) body: { reason: string },
  ) {
    return this.lifecycle(admin, id, 'reactivate', body.reason);
  }

  /** Closing a school is for owners only. */
  @Post(':id/cancel')
  @HttpCode(200)
  @PlatformOwnerOnly()
  cancel(
    @CurrentAdmin() admin: PlatformUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reasonSchema)) body: { reason: string },
  ) {
    return this.lifecycle(admin, id, 'cancel', body.reason);
  }

  private async lifecycle(
    admin: PlatformUser,
    id: string,
    action: LifecycleAction,
    reason: string,
  ) {
    const sub = await this.prisma.subscription.findUnique({
      where: { schoolId: id },
    });
    if (!sub) throw new NotFoundException('School has no subscription');
    const target = lifecycleTarget(action, sub.status);
    if ('error' in target) throw new ConflictException(target.error);
    // Only moves the school if nobody changed its status since we read it, so
    // two concurrent requests cannot both pass the transition check.
    const { count } = await this.prisma.subscription.updateMany({
      where: { schoolId: id, status: sub.status },
      data: { status: target.status },
    });
    if (!count)
      throw new ConflictException(
        'This school changed while you were working. Reload and try again.',
      );
    this.subscriptions.forget(id);
    await logPlatform(this.prisma, admin, `school.${action}`, id, {
      reason,
      before: { status: sub.status },
      after: { status: target.status },
    });
    return { status: target.status };
  }

  // ----- Per-school modules -----

  @Put(':id/features')
  @PlatformOwnerOnly()
  async features(
    @CurrentAdmin() admin: PlatformUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(featuresSchema))
    body: z.infer<typeof featuresSchema>,
  ) {
    const sub = await this.prisma.subscription.findUnique({
      where: { schoolId: id },
      include: { plan: true },
    });
    if (!sub) throw new NotFoundException('School has no subscription');
    // Only store real differences from the plan, so a later plan change
    // is not shadowed by stale overrides.
    const added = body.added.filter((f) => !sub.plan.features.includes(f));
    const removed = body.removed.filter((f) => sub.plan.features.includes(f));
    await this.prisma.subscription.update({
      where: { schoolId: id },
      data: { featuresAdded: added, featuresRemoved: removed },
    });
    this.subscriptions.forget(id);
    await logPlatform(this.prisma, admin, 'school.features', id, {
      before: { added: sub.featuresAdded, removed: sub.featuresRemoved },
      after: { added, removed },
    });
    return {
      planFeatures: sub.plan.features,
      featuresAdded: added,
      featuresRemoved: removed,
      features: effectiveFeatures(sub.plan.features, added, removed),
    };
  }

  // ----- People -----

  @Get(':id/users')
  async users(@Param('id') id: string) {
    await this.assertSchool(id);
    return this.prisma.user.findMany({
      where: { schoolId: id, roles: { some: { role: { in: STAFF_ROLES } } } },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: userSelect,
    });
  }

  @Post(':id/users')
  async createUser(
    @CurrentAdmin() admin: PlatformUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createUserSchema))
    body: z.infer<typeof createUserSchema>,
  ) {
    await this.assertSchool(id);
    const roles = await this.resolveGrants(id, body.roles);
    assertMayGrantOwner(admin, roles);
    const password = temporaryPassword();
    let created;
    try {
      created = await this.prisma.user.create({
        data: {
          schoolId: id,
          name: body.name,
          email: body.email,
          phone: body.phone,
          passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
          mustChangePassword: true,
          roles: { create: roles },
        },
        select: userSelect,
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      )
        throw new ConflictException(
          'Someone at this school already uses this email or phone',
        );
      throw e;
    }
    const after = { name: created.name, roles };
    await logToSchool(this.prisma, admin, id, 'user.create', 'User', created.id, { after });
    await logPlatform(this.prisma, admin, 'school.user.create', id, {
      userId: created.id,
      ...after,
    });
    return { user: created, temporaryPassword: password };
  }

  @Patch(':id/users/:uid')
  async updateUser(
    @CurrentAdmin() admin: PlatformUser,
    @Param('id') id: string,
    @Param('uid') uid: string,
    @Body(new ZodValidationPipe(updateUserSchema))
    body: z.infer<typeof updateUserSchema>,
  ) {
    const before = await this.findUser(id, uid);
    const roles = body.roles
      ? await this.resolveGrants(id, body.roles)
      : undefined;
    // Owner accounts (and making someone an owner) are for SchoolSyncer owners.
    assertMayGrantOwner(admin, [...before.roles, ...(roles ?? [])]);
    const after = await serializable(this.prisma, async (tx) => {
      if (roles) {
        // Only staff grants are replaced: a teacher who is also a parent
        // keeps their PARENT (and any STUDENT) grant.
        await tx.roleAssignment.deleteMany({
          where: { userId: uid, role: { in: STAFF_ROLES } },
        });
        await tx.roleAssignment.createMany({
          data: roles.map((r) => ({ ...r, userId: uid })),
        });
      }
      const updated = await tx.user.update({
        where: { id: uid },
        data: { isActive: body.isActive },
        select: userSelect,
      });
      const owners = await tx.user.count({
        where: {
          schoolId: id,
          isActive: true,
          roles: { some: { role: Role.OWNER } },
        },
      });
      if (!owners)
        throw new ConflictException(
          'The school needs at least one active owner',
        );
      return updated;
    });
    // Deactivation and new grants apply on the user's next request.
    this.userStatus.forget(uid);
    const change = {
      before: { isActive: before.isActive, roles: grantsOf(before) },
      after: { isActive: after.isActive, roles: grantsOf(after) },
    };
    await logToSchool(this.prisma, admin, id, 'user.update', 'User', uid, change);
    await logPlatform(this.prisma, admin, 'school.user.update', id, {
      userId: uid,
      ...change,
    });
    return after;
  }

  /**
   * Returns a new temporary password once. Resetting an owner's password
   * lets the caller sign in as the owner, so that is for SchoolSyncer owners
   * only (support staff use a time-limited support session instead).
   */
  @Post(':id/users/:uid/reset-password')
  async resetPassword(
    @CurrentAdmin() admin: PlatformUser,
    @Param('id') id: string,
    @Param('uid') uid: string,
    @Body(new ZodValidationPipe(optionalReasonSchema))
    body: z.infer<typeof optionalReasonSchema>,
  ) {
    const target = await this.findUser(id, uid);
    assertMayGrantOwner(admin, target.roles);
    const password = temporaryPassword();
    await this.prisma.user.update({
      where: { id: uid },
      data: {
        passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
        mustChangePassword: true,
        // Ends the user's open sessions.
        tokenVersion: { increment: 1 },
      },
    });
    this.userStatus.forget(uid);
    const reason = body?.reason;
    await logToSchool(
      this.prisma,
      admin,
      id,
      'user.reset_password',
      'User',
      uid,
      reason ? { after: { reason } } : {},
    );
    await logPlatform(this.prisma, admin, 'school.user.reset_password', id, {
      userId: uid,
      ...(reason ? { reason } : {}),
    });
    return { temporaryPassword: password };
  }

  // ----- Helpers -----

  private async assertSchool(id: string) {
    const school = await this.prisma.school.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!school) throw new NotFoundException('School not found');
  }

  /** The user, only if they belong to this school. */
  private async findUser(schoolId: string, uid: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: uid, schoolId },
      select: userSelect,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /**
   * Checks campuses and custom roles belong to this school and turns custom
   * roles into grants of their base role. Only staff roles: parents and
   * students are added through the school's own admissions.
   */
  private async resolveGrants(schoolId: string, grants: GrantInput[]) {
    const campusIds = [
      ...new Set(grants.map((g) => g.campusId).filter((c) => c !== null)),
    ];
    const customIds = [
      ...new Set(grants.map((g) => g.customRoleId).filter((c) => c !== null)),
    ];
    const [campuses, customRoles] = await Promise.all([
      this.prisma.campus.count({ where: { id: { in: campusIds }, schoolId } }),
      this.prisma.customRole.findMany({
        where: { id: { in: customIds }, schoolId },
        select: { id: true, baseRole: true },
      }),
    ]);
    if (campuses !== campusIds.length)
      throw new NotFoundException('Campus not found');
    if (customRoles.length !== customIds.length)
      throw new NotFoundException('Custom role not found');
    const base = new Map(customRoles.map((r) => [r.id, r.baseRole]));
    const out = grants.map((g) => {
      const role = g.customRoleId ? base.get(g.customRoleId)! : g.role;
      if (!role) throw new BadRequestException('Each grant needs a role');
      if (!STAFF_ROLES.includes(role))
        throw new BadRequestException('Only staff roles can be given here');
      return { role, campusId: g.campusId, customRoleId: g.customRoleId };
    });
    const seen = new Set(out.map((g) => `${g.role}|${g.campusId}|${g.customRoleId}`));
    if (seen.size !== out.length)
      throw new BadRequestException('The same role is listed twice');
    return out;
  }
}

/** Owner accounts are touched, and OWNER granted, by SchoolSyncer owners only. */
function assertMayGrantOwner(admin: PlatformUser, grants: { role: Role }[]) {
  if (
    admin.role !== PlatformRole.OWNER &&
    grants.some((g) => g.role === Role.OWNER)
  )
    throw new ForbiddenException(
      'Only a SchoolSyncer owner can change or create a school owner account',
    );
}

function grantsOf(user: {
  roles: { role: Role; campusId: string | null; customRoleId: string | null }[];
}) {
  return user.roles.map(({ role, campusId, customRoleId }) => ({
    role,
    campusId,
    customRoleId,
  }));
}
