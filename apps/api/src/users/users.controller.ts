import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { BCRYPT_ROUNDS } from '../auth/school-setup.service.js';
import { adminScope, SETUP_ROLES, STAFF_ROLES } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Permission, Roles } from '../common/decorators.js';
import { PermissionService } from '../common/permission.service.js';
import { serializable } from '../common/serializable.js';
import { effectivePermissions, grantMatrix, moduleLabel, overGranted } from '../common/permissions.js';
import { UserStatusService } from '../common/user-status.service.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { temporaryPassword } from '../platform/temp-password.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  addedGrants,
  campusScopeViolation,
  hasDuplicateGrant,
  holdsOwner,
  ownerRuleViolation,
  USER_STATUSES,
  userListWhere,
  type StoredGrant,
} from './user-rules.js';

/**
 * A role grant. Either a built-in `role`, or a `customRoleId` (then `role` may
 * be omitted; if given it must equal the custom role's base role). Stored as
 * { role: customRole.baseRole, customRoleId }.
 */
const grantSchema = z.object({
  role: z.enum(Role).optional(),
  campusId: z.string().min(1).nullable().default(null),
  customRoleId: z.string().min(1).nullable().default(null),
});
type GrantInput = z.infer<typeof grantSchema>;

const createUserSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    email: z.email().toLowerCase().optional(),
    phone: z.string().trim().min(10).max(20).optional(),
    // Omit to have a temporary password generated and returned once.
    password: z.string().min(8).max(128).optional(),
    roles: z.array(grantSchema).min(1),
  })
  .refine((u) => u.email || u.phone, {
    message: 'Give an email or a phone number',
    path: ['email'],
  });
type CreateUserInput = z.infer<typeof createUserSchema>;

const updateUserSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    email: z.email().toLowerCase().nullable().optional(),
    phone: z.string().trim().min(10).max(20).nullable().optional(),
    roles: z.array(grantSchema).min(1).optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), 'Nothing to change');
type UpdateUserInput = z.infer<typeof updateUserSchema>;

const listQuerySchema = z.object({
  search: z.string().max(120).optional(),
  role: z.enum(Role).optional(),
  customRoleId: z.string().optional(),
  status: z.enum(USER_STATUSES).default('all'),
  campusId: z.string().optional(),
  type: z.enum(['staff', 'all']).default('all'),
});
type ListQuery = z.infer<typeof listQuerySchema>;

const userSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  staffProfile: {
    select: { employeeNo: true, designation: true, department: true, status: true },
  },
  roles: {
    select: {
      id: true,
      role: true,
      campusId: true,
      customRoleId: true,
      campus: { select: { id: true, name: true } },
      customRole: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.UserSelect;
type SelectedUser = Prisma.UserGetPayload<{ select: typeof userSelect }>;

const grantsOf = (u: { roles: StoredGrant[] }): StoredGrant[] =>
  u.roles.map(({ role, campusId, customRoleId }) => ({ role, campusId, customRoleId }));

/** What goes into the audit log for a user (no password hash, no ids of joins). */
const snapshot = (u: SelectedUser) => ({
  name: u.name,
  email: u.email,
  phone: u.phone,
  isActive: u.isActive,
  roles: grantsOf(u),
});

@Controller('users')
@Permission('users')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly permissions: PermissionService,
    private readonly userStatus: UserStatusService,
  ) {}

  /** GET /users?search&role&customRoleId&status&campusId&type */
  @Get()
  @Roles(...SETUP_ROLES)
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listQuerySchema)) query: ListQuery,
  ) {
    return this.prisma.user.findMany({
      where: userListWhere(user.schoolId, query, adminScope(user)),
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: userSelect,
    });
  }

  /** One person, for the staff directory profile drawer. */
  @Get(':id')
  @Roles(...SETUP_ROLES)
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const found = await this.prisma.user.findFirst({
      where: userListWhere(user.schoolId, {}, adminScope(user), id),
      select: {
        ...userSelect,
        staffProfile: {
          select: {
            employeeNo: true,
            designation: true,
            department: true,
            status: true,
            joinedOn: true,
          },
        },
        _count: { select: { timetableSlots: true, classTeacherOf: true, teachesSubjects: true } },
      },
    });
    if (!found) throw new NotFoundException('User not found');
    const { _count, ...rest } = found;
    return {
      ...rest,
      load: {
        timetablePeriods: _count.timetableSlots,
        classTeacherOf: _count.classTeacherOf,
        subjectsTaught: _count.teachesSubjects,
      },
    };
  }

  @Post()
  @Roles(...SETUP_ROLES)
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createUserSchema)) body: CreateUserInput,
  ) {
    const roles = await this.resolveGrants(user, body.roles, []);
    const generated = body.password ? undefined : temporaryPassword();
    let created: SelectedUser;
    try {
      created = await this.prisma.user.create({
        data: {
          schoolId: user.schoolId,
          name: body.name,
          email: body.email,
          phone: body.phone,
          passwordHash: await bcrypt.hash(body.password ?? generated!, BCRYPT_ROUNDS),
          // The admin knows this password, so the user replaces it on first sign-in.
          mustChangePassword: true,
          roles: { create: roles },
        },
        select: userSelect,
      });
    } catch (e) {
      throw conflictOnDuplicate(e);
    }
    await this.audit.record(user, 'user.create', 'User', created.id, {
      after: snapshot(created),
    });
    return generated ? { ...created, temporaryPassword: generated } : created;
  }

  @Patch(':id')
  @Roles(...SETUP_ROLES)
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) body: UpdateUserInput,
  ) {
    const before = await this.findUser(user, id);
    await this.assertMayTouch(user, before);
    const roles = body.roles ? await this.resolveGrants(user, body.roles, grantsOf(before)) : undefined;
    const email = body.email === undefined ? before.email : body.email;
    const phone = body.phone === undefined ? before.phone : body.phone;
    if (!email && !phone) throw new BadRequestException('Give an email or a phone number');

    let after: SelectedUser;
    try {
      after = await serializable(this.prisma, async (tx) => {
        if (roles) {
          await tx.roleAssignment.deleteMany({ where: { userId: id } });
          await tx.roleAssignment.createMany({ data: roles.map((r) => ({ ...r, userId: id })) });
        }
        // Fails (P2002 -> 409) if two editors wrote the same grant at once.
        const updated = await tx.user.update({
          where: { id },
          data: { name: body.name, email: body.email, phone: body.phone },
          select: userSelect,
        });
        if (roles) await assertActiveOwnerRemains(tx, user.schoolId);
        return updated;
      });
    } catch (e) {
      throw conflictOnDuplicate(e);
    }
    // Their next request uses the new grants (JwtAuthGuard reads them live).
    if (roles) this.userStatus.forget(id);
    await this.audit.record(user, 'user.update', 'User', id, {
      before: snapshot(before),
      after: snapshot(after),
    });
    return after;
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @Roles(...SETUP_ROLES)
  async deactivate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    if (id === user.sub) throw new BadRequestException('You cannot deactivate your own account');
    return this.setActive(user, id, false);
  }

  @Post(':id/activate')
  @HttpCode(200)
  @Roles(...SETUP_ROLES)
  activate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.setActive(user, id, true);
  }

  /** Sets a new temporary password and returns it once; it is not stored in clear anywhere. */
  @Post(':id/reset-password')
  @HttpCode(200)
  @Roles(...SETUP_ROLES)
  async resetPassword(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const target = await this.findUser(user, id);
    await this.assertMayTouch(user, target);
    const password = temporaryPassword();
    await this.prisma.user.update({
      where: { id },
      data: {
        passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
        mustChangePassword: true,
        // Ends the user's open sessions.
        tokenVersion: { increment: 1 },
      },
    });
    this.userStatus.forget(id);
    await this.audit.record(user, 'user.reset_password', 'User', id);
    return { temporaryPassword: password };
  }

  // ----- Helpers -----

  private async setActive(user: AuthUser, id: string, isActive: boolean) {
    const before = await this.findUser(user, id);
    await this.assertMayTouch(user, before);
    if (before.isActive === isActive) return before;
    const after = await serializable(this.prisma, async (tx) => {
      const updated = await tx.user.update({ where: { id }, data: { isActive }, select: userSelect });
      if (!isActive && holdsOwner(before.roles)) await assertActiveOwnerRemains(tx, user.schoolId);
      return updated;
    });
    this.userStatus.forget(id);
    await this.audit.record(user, isActive ? 'user.activate' : 'user.deactivate', 'User', id, {
      before: { isActive: before.isActive },
      after: { isActive: after.isActive },
    });
    return after;
  }

  /** The user, only if they belong to the caller's school (and campus scope). */
  private async findUser(user: AuthUser, id: string): Promise<SelectedUser> {
    const found = await this.prisma.user.findFirst({
      where: userListWhere(user.schoolId, {}, adminScope(user), id),
      select: userSelect,
    });
    if (!found) throw new NotFoundException('User not found');
    return found;
  }

  /**
   * Whether the caller may edit, deactivate or reset the password of
   * `target`. Owners may touch anyone. Others only people with no more access
   * than they have themselves, and (when campus-scoped) only people whose
   * staff grants all sit on the caller's campuses: otherwise an admin could
   * reset a principal's password and sign in as them.
   */
  private async assertMayTouch(user: AuthUser, target: SelectedUser) {
    const editorIsOwner = holdsOwner(user.roles);
    const problem = ownerRuleViolation({ editorIsOwner, targetGrants: target.roles });
    if (problem) throw new ForbiddenException(problem);
    if (editorIsOwner || target.id === user.sub) return;
    const outside = campusScopeViolation(adminScope(user), target.roles);
    if (outside) throw new ForbiddenException('You can only change people on your own campuses');
    // Staff grants only: parent and student access is fenced by ownership
    // checks, not by the matrix, so it says nothing about what an account can do.
    const staff = <G extends { role: Role }>(grants: G[]) => grants.filter((g) => STAFF_ROLES.includes(g.role));
    const overrides = await this.permissions.overridesFor(user.schoolId);
    const over = overGranted(
      effectivePermissions(staff(user.roles), overrides),
      effectivePermissions(staff(target.roles), overrides),
    );
    if (over.length) {
      throw new ForbiddenException(
        `You cannot change someone with more access than you have: ${over.map(moduleLabel).join(', ')}`,
      );
    }
  }

  /**
   * Validates grants for the caller's school: campuses and custom roles must
   * belong to it, a custom role's base role must match any `role` given, only
   * an owner can grant OWNER, and (delegation) a newly added grant may not
   * carry more access than the caller has.
   */
  private async resolveGrants(user: AuthUser, grants: GrantInput[], current: StoredGrant[]): Promise<StoredGrant[]> {
    const campusIds = [...new Set(grants.map((g) => g.campusId).filter((c): c is string => c !== null))];
    const customIds = [...new Set(grants.map((g) => g.customRoleId).filter((c): c is string => c !== null))];
    const [campuses, customRoles] = await Promise.all([
      campusIds.length
        ? this.prisma.campus.count({ where: { id: { in: campusIds }, schoolId: user.schoolId } })
        : 0,
      customIds.length
        ? this.prisma.customRole.findMany({
            where: { id: { in: customIds }, schoolId: user.schoolId },
            select: { id: true, baseRole: true, name: true },
          })
        : [],
    ]);
    if (campuses !== campusIds.length) throw new NotFoundException('Campus not found');
    if (customRoles.length !== customIds.length) throw new NotFoundException('Custom role not found');
    const custom = new Map(customRoles.map((r) => [r.id, r]));

    const out = grants.map((g): StoredGrant => {
      if (g.customRoleId) {
        const role = custom.get(g.customRoleId)!;
        if (g.role && g.role !== role.baseRole) {
          throw new BadRequestException(`${role.name} is based on ${role.baseRole}, not ${g.role}`);
        }
        return { role: role.baseRole, campusId: g.campusId, customRoleId: g.customRoleId };
      }
      if (!g.role) throw new BadRequestException('Each role needs a role or a customRoleId');
      return { role: g.role, campusId: g.campusId, customRoleId: null };
    });
    if (hasDuplicateGrant(out)) throw new BadRequestException('The same role is listed twice');

    // A campus-scoped editor may only grant roles on their own campuses.
    const scope = adminScope(user);
    if (scope && campusScopeViolation(scope, addedGrants(current, out))) {
      throw new ForbiddenException('You can only give roles on your own campuses');
    }

    const editorIsOwner = holdsOwner(user.roles);
    const problem = ownerRuleViolation({ editorIsOwner, nextGrants: addedGrants(current, out) });
    if (problem) throw new ForbiddenException(problem);

    if (!editorIsOwner) {
      const added = addedGrants(current, out);
      if (added.length) {
        const [mine, overrides] = await Promise.all([
          this.permissions.permissionsFor(user),
          this.permissions.overridesFor(user.schoolId),
        ]);
        const over = new Set(added.flatMap((g) => overGranted(mine, grantMatrix(g, overrides))));
        if (over.size) {
          throw new ForbiddenException(
            `You cannot grant more access than you have: ${[...over].map(moduleLabel).join(', ')}`,
          );
        }
      }
    }
    return out;
  }
}

/** Last-owner protection, checked inside the write transaction. */
async function assertActiveOwnerRemains(tx: Prisma.TransactionClient, schoolId: string) {
  const owners = await tx.user.count({
    where: { schoolId, isActive: true, roles: { some: { role: Role.OWNER } } },
  });
  if (!owners) throw new ConflictException('The school needs at least one active owner');
}

function conflictOnDuplicate(e: unknown) {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    return new ConflictException('Someone at this school already uses this email or phone');
  }
  return e;
}
