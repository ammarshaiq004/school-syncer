import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { Prisma, Role, type CustomRole } from '@prisma/client';
import { z } from 'zod';
import { SETUP_ROLES } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Permission, Roles } from '../common/decorators.js';
import { PermissionService } from '../common/permission.service.js';
import { UserStatusService } from '../common/user-status.service.js';
import {
  ACCESS_LEVELS,
  builtinMatrix,
  clean,
  CUSTOM_ROLE_BASES,
  DEFAULT_PERMISSIONS,
  diffMatrix,
  EDITABLE_BUILTIN_ROLES,
  grantMatrix,
  MODULE_KEYS,
  PERMISSION_GROUPS,
  PERMISSION_MODULES,
  type PermissionMatrix,
  type PermissionOverrides,
} from '../common/permissions.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { copyName, delegationMessage, delegationViolations, ROLE_LABELS } from './roles.rules.js';

const matrixSchema = z.partialRecord(z.enum(MODULE_KEYS), z.enum(ACCESS_LEVELS));
const editableRole = z.enum(EDITABLE_BUILTIN_ROLES as [Role, ...Role[]]);
const customBase = z.enum(CUSTOM_ROLE_BASES as [Role, ...Role[]]);
const roleName = z.string().trim().min(2).max(80);
const description = z.string().trim().max(300);

const builtinUpdateSchema = z.object({
  permissions: matrixSchema,
  /** true: start from the defaults instead of the school's current matrix. */
  reset: z.boolean().optional(),
});
type BuiltinUpdateInput = z.infer<typeof builtinUpdateSchema>;

const createSchema = z.object({
  name: roleName,
  description: description.optional(),
  baseRole: customBase,
  permissions: matrixSchema.default({}),
});
type CreateInput = z.infer<typeof createSchema>;

const updateSchema = z.object({
  name: roleName.optional(),
  description: description.nullable().optional(),
  baseRole: customBase.optional(),
  permissions: matrixSchema.optional(),
});
type UpdateInput = z.infer<typeof updateSchema>;

const duplicateSchema = z.object({ name: roleName.optional() }).default({});
type DuplicateInput = z.infer<typeof duplicateSchema>;

/** Built-in roles shown on the roles page: the owner (read-only) and the editable ones. */
const LISTED_BUILTINS: Role[] = [Role.OWNER, ...EDITABLE_BUILTIN_ROLES];

/**
 * Roles and permissions (SCHOOL-16/79/80). Built-in role edits live in
 * BuiltinRolePermission, custom roles in CustomRole; both store only the
 * modules that differ from what they build on. Every write clears the
 * school's PermissionService cache so it applies on the next request.
 */
@Controller('roles')
@Roles(...SETUP_ROLES)
@Permission('users')
export class RolesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly permissions: PermissionService,
    private readonly userStatus: UserStatusService,
  ) {}

  /** The module catalog, grouped, for the matrix editor. */
  @Get('modules')
  modules() {
    return {
      levels: ACCESS_LEVELS,
      groups: Object.entries(PERMISSION_GROUPS).map(([key, label]) => ({
        key,
        label,
        modules: MODULE_KEYS.filter((m) => PERMISSION_MODULES[m].group === key).map((m) => ({
          key: m,
          label: PERMISSION_MODULES[m].label,
        })),
      })),
      modules: MODULE_KEYS.map((m) => ({ key: m, ...PERMISSION_MODULES[m] })),
    };
  }

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const [overrides, customs, assignments] = await Promise.all([
      this.permissions.overridesFor(user.schoolId),
      this.prisma.customRole.findMany({ where: { schoolId: user.schoolId }, orderBy: { name: 'asc' } }),
      this.prisma.roleAssignment.findMany({
        // Role cards count active people; DELETE checks every holder.
        where: { user: { schoolId: user.schoolId, isActive: true } },
        select: { userId: true, role: true, customRoleId: true },
      }),
    ]);
    const members = new Map<string, Set<string>>();
    for (const a of assignments) {
      const key = a.customRoleId ?? a.role;
      if (!members.has(key)) members.set(key, new Set());
      members.get(key)!.add(a.userId);
    }
    const count = (key: string) => members.get(key)?.size ?? 0;
    return {
      builtin: LISTED_BUILTINS.map((role) => this.builtinView(role, overrides, count(role))),
      custom: customs.map((c) => this.customView(c, overrides, count(c.id))),
    };
  }

  @Put('builtin/:role')
  async updateBuiltin(
    @CurrentUser() user: AuthUser,
    @Param('role') roleParam: string,
    @Body(new ZodValidationPipe(builtinUpdateSchema)) body: BuiltinUpdateInput,
  ) {
    if (roleParam === Role.OWNER) throw new BadRequestException('The owner role always has full access');
    const parsed = editableRole.safeParse(roleParam);
    if (!parsed.success) throw new BadRequestException('This role cannot be edited');
    const role = parsed.data;

    const overrides = await this.permissions.overridesFor(user.schoolId);
    const current = builtinMatrix(role, overrides);
    const next: PermissionMatrix = { ...(body.reset ? DEFAULT_PERMISSIONS[role] : current), ...clean(body.permissions) };
    await this.assertCanGrant(user, current, next);

    const stored = diffMatrix(DEFAULT_PERMISSIONS[role], next);
    const where = { schoolId_role: { schoolId: user.schoolId, role } };
    const before = await this.prisma.builtinRolePermission.findUnique({ where });
    if (Object.keys(stored).length) {
      await this.prisma.builtinRolePermission.upsert({
        where,
        create: { schoolId: user.schoolId, role, permissions: stored },
        update: { permissions: stored },
      });
    } else if (before) {
      await this.prisma.builtinRolePermission.delete({ where });
    }
    await this.audit.record(user, 'role.builtin.update', 'BuiltinRolePermission', role, {
      before: before?.permissions ?? {},
      after: stored,
    });
    return this.refreshed(user, (o, count) => this.builtinView(role, o, count(role)));
  }

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createSchema)) body: CreateInput,
  ) {
    await this.assertNameFree(user.schoolId, body.name);
    const overrides = await this.permissions.overridesFor(user.schoolId);
    const base = builtinMatrix(body.baseRole, overrides);
    const next: PermissionMatrix = { ...base, ...clean(body.permissions) };
    await this.assertCanGrant(user, base, next);

    const role = await this.saveUnique(() =>
      this.prisma.customRole.create({
        data: {
          schoolId: user.schoolId,
          name: body.name,
          description: body.description || null,
          baseRole: body.baseRole,
          permissions: diffMatrix(base, next),
        },
      }),
    );
    await this.audit.record(user, 'role.create', 'CustomRole', role.id, { after: role });
    return this.refreshed(user, (o) => this.customView(role, o, 0));
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSchema)) body: UpdateInput,
  ) {
    const before = await this.findOwned(user, id);
    if (body.name && body.name !== before.name) await this.assertNameFree(user.schoolId, body.name, id);

    const overrides = await this.permissions.overridesFor(user.schoolId);
    const current = grantMatrix({ role: before.baseRole, customRoleId: id }, overrides);
    const baseRole = body.baseRole ?? before.baseRole;
    const base = builtinMatrix(baseRole, overrides);
    const next: PermissionMatrix = { ...base, ...clean(before.permissions), ...clean(body.permissions) };
    await this.assertCanGrant(user, current, next);

    const after = await this.saveUnique(() =>
      this.prisma.$transaction(async (tx) => {
        const updated = await tx.customRole.update({
          where: { id },
          data: {
            name: body.name,
            description: body.description === undefined ? undefined : body.description || null,
            baseRole,
            permissions: diffMatrix(base, next),
          },
        });
        // A custom-role grant is stored as { role: baseRole, customRoleId }, so
        // its holders move with it. JwtAuthGuard reads grants live, so they
        // get the new base role (the @Roles ceiling) on their next request.
        if (baseRole !== before.baseRole) {
          await tx.roleAssignment.updateMany({ where: { customRoleId: id }, data: { role: baseRole } });
        }
        return updated;
      }),
    );
    if (after.baseRole !== before.baseRole) this.userStatus.forget();
    await this.audit.record(user, 'role.update', 'CustomRole', id, { before, after });
    return this.refreshed(user, (o, count) => this.customView(after, o, count(id)));
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const before = await this.findOwned(user, id);
    const holders = await this.prisma.roleAssignment.findMany({
      where: { customRoleId: id },
      select: { userId: true },
      distinct: ['userId'],
    });
    if (holders.length) {
      throw new ConflictException(
        `${before.name} is assigned to ${holders.length} ${holders.length === 1 ? 'person' : 'people'}. Change their roles first.`,
      );
    }
    try {
      await this.prisma.customRole.delete({ where: { id } });
    } catch (error) {
      // Assigned between the check and the delete (RoleAssignment is ON DELETE RESTRICT).
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new ConflictException(`${before.name} is assigned to someone. Change their roles first.`);
      }
      throw error;
    }
    await this.audit.record(user, 'role.delete', 'CustomRole', id, { before });
    this.permissions.forget(user.schoolId);
    return { deleted: true };
  }

  @Post(':id/duplicate')
  async duplicate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(duplicateSchema)) body: DuplicateInput,
  ) {
    const source = await this.findOwned(user, id);
    let name = body.name;
    if (name) {
      await this.assertNameFree(user.schoolId, name);
    } else {
      const taken = await this.prisma.customRole.findMany({
        where: { schoolId: user.schoolId },
        select: { name: true },
      });
      name = copyName(source.name, [...taken.map((t) => t.name), ...Object.values(ROLE_LABELS)]);
    }
    // Copies an existing role unchanged, so it grants nothing new: no delegation check.
    const role = await this.saveUnique(() =>
      this.prisma.customRole.create({
        data: {
          schoolId: user.schoolId,
          name: name!,
          description: source.description,
          baseRole: source.baseRole,
          permissions: clean(source.permissions),
        },
      }),
    );
    await this.audit.record(user, 'role.duplicate', 'CustomRole', role.id, {
      before: { sourceId: source.id, name: source.name },
      after: role,
    });
    return this.refreshed(user, (o) => this.customView(role, o, 0));
  }

  private builtinView(role: Role, overrides: PermissionOverrides, memberCount: number) {
    const stored = clean(overrides.builtin?.[role]);
    return {
      role,
      name: ROLE_LABELS[role],
      editable: EDITABLE_BUILTIN_ROLES.includes(role),
      permissions: builtinMatrix(role, overrides),
      defaults: DEFAULT_PERMISSIONS[role],
      customized: role !== Role.OWNER && Object.keys(stored).length > 0,
      memberCount,
    };
  }

  private customView(role: CustomRole, overrides: PermissionOverrides, memberCount: number) {
    return {
      id: role.id,
      name: role.name,
      description: role.description,
      baseRole: role.baseRole,
      baseRoleName: ROLE_LABELS[role.baseRole],
      permissions: grantMatrix({ role: role.baseRole, customRoleId: role.id }, overrides),
      overrides: clean(role.permissions),
      memberCount,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    };
  }

  /** Clears the cache, reloads the school's matrix and builds the response from it. */
  private async refreshed<T>(
    user: AuthUser,
    view: (overrides: PermissionOverrides, count: (key: string) => number) => T,
  ): Promise<T> {
    this.permissions.forget(user.schoolId);
    const [overrides, assignments] = await Promise.all([
      this.permissions.overridesFor(user.schoolId),
      this.prisma.roleAssignment.findMany({
        // Role cards count active people; DELETE checks every holder.
        where: { user: { schoolId: user.schoolId, isActive: true } },
        select: { userId: true, role: true, customRoleId: true },
      }),
    ]);
    const count = (key: string) =>
      new Set(assignments.filter((a) => (a.customRoleId ?? a.role) === key).map((a) => a.userId)).size;
    return view(overrides, count);
  }

  private async assertCanGrant(user: AuthUser, current: PermissionMatrix, next: PermissionMatrix) {
    const editor = await this.permissions.permissionsFor(user);
    const violations = delegationViolations(editor, current, next);
    if (violations.length) throw new ForbiddenException(delegationMessage(violations));
  }

  private async assertNameFree(schoolId: string, name: string, exceptId?: string) {
    const clash =
      Object.values(ROLE_LABELS).some((label) => label.toLowerCase() === name.toLowerCase()) ||
      (await this.prisma.customRole.findFirst({
        where: { schoolId, name: { equals: name, mode: 'insensitive' }, id: exceptId ? { not: exceptId } : undefined },
        select: { id: true },
      }));
    if (clash) throw new ConflictException(`A role named "${name}" already exists`);
  }

  private async saveUnique<T>(save: () => Promise<T>): Promise<T> {
    try {
      return await save();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A role with this name already exists');
      }
      throw error;
    }
  }

  private async findOwned(user: AuthUser, id: string) {
    const role = await this.prisma.customRole.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }
}
