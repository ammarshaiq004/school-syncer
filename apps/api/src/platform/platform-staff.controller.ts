import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PlatformRole, Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { BCRYPT_ROUNDS } from '../auth/school-setup.service.js';
import type { PlatformUser } from '../common/auth-user.js';
import { CurrentAdmin, PlatformOnly } from '../common/decorators.js';
import { serializable } from '../common/serializable.js';
import { UserStatusService } from '../common/user-status.service.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { staffChangeError } from './lifecycle.js';
import {
  PlatformAccessGuard,
  PlatformOwnerOnly,
} from './platform-access.guard.js';
import { logPlatform } from './platform-audit.js';
import { temporaryPassword } from './temp-password.js';

const createStaffSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email().toLowerCase(),
  role: z.enum(PlatformRole).default(PlatformRole.SUPPORT),
});

const updateStaffSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    role: z.enum(PlatformRole).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change');

const staffSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  mustChangePassword: true,
  lastLoginAt: true,
  createdAt: true,
} satisfies Prisma.PlatformAdminSelect;

/** SchoolSyncer's own team: who can sign in to the console. Owners only. */
@Controller('platform/staff')
@PlatformOnly()
@PlatformOwnerOnly()
@UseGuards(PlatformAccessGuard)
export class PlatformStaffController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userStatus: UserStatusService,
  ) {}

  @Get()
  list() {
    return this.prisma.platformAdmin.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: staffSelect,
    });
  }

  /** Returns the temporary password once; the new member must change it on first sign-in. */
  @Post()
  async create(
    @CurrentAdmin() admin: PlatformUser,
    @Body(new ZodValidationPipe(createStaffSchema))
    body: z.infer<typeof createStaffSchema>,
  ) {
    const password = temporaryPassword();
    try {
      const staff = await this.prisma.platformAdmin.create({
        data: {
          name: body.name,
          email: body.email,
          role: body.role,
          mustChangePassword: true,
          passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
        },
        select: staffSelect,
      });
      await logPlatform(this.prisma, admin, 'staff.create', null, {
        staffId: staff.id,
        email: staff.email,
        role: staff.role,
      });
      return { staff, temporaryPassword: password };
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      )
        throw new ConflictException('A staff member with this email exists');
      throw e;
    }
  }

  @Patch(':id')
  async update(
    @CurrentAdmin() admin: PlatformUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateStaffSchema))
    body: z.infer<typeof updateStaffSchema>,
  ) {
    // Read, check and write in one serializable transaction so two owners
    // demoting each other at once cannot leave SchoolSyncer with none.
    const { before, after } = await serializable(this.prisma, async (tx) => {
      const before = await tx.platformAdmin.findUnique({
        where: { id },
        select: staffSelect,
      });
      if (!before) throw new NotFoundException('Staff member not found');
      const activeOwners = await tx.platformAdmin.count({
        where: { role: PlatformRole.OWNER, isActive: true },
      });
      const error = staffChangeError(admin.sub, before, body, activeOwners);
      if (error) throw new BadRequestException(error);
      const after = await tx.platformAdmin.update({
        where: { id },
        data: body,
        select: staffSelect,
      });
      return { before, after };
    });
    // Support sessions this staff member opened stop working when they are deactivated.
    this.userStatus.forgetAdmin(id);
    await logPlatform(this.prisma, admin, 'staff.update', null, {
      staffId: id,
      before: { name: before.name, role: before.role, isActive: before.isActive },
      after: { name: after.name, role: after.role, isActive: after.isActive },
    });
    return after;
  }

  @Post(':id/reset-password')
  async resetPassword(
    @CurrentAdmin() admin: PlatformUser,
    @Param('id') id: string,
  ) {
    const staff = await this.prisma.platformAdmin.findUnique({ where: { id } });
    if (!staff) throw new NotFoundException('Staff member not found');
    const password = temporaryPassword();
    await this.prisma.platformAdmin.update({
      where: { id },
      data: {
        passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
        mustChangePassword: true,
        // Ends the member's open console sessions.
        tokenVersion: { increment: 1 },
      },
    });
    await logPlatform(this.prisma, admin, 'staff.reset_password', null, {
      staffId: id,
      email: staff.email,
    });
    return { temporaryPassword: password };
  }
}
