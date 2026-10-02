import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { SETUP_ROLES } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Roles } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';

const createUserSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    email: z.email().toLowerCase().optional(),
    phone: z.string().trim().min(10).max(20).optional(),
    password: z.string().min(8).max(128),
    roles: z
      .array(
        z.object({
          role: z.enum(Role),
          campusId: z.string().nullable().default(null),
        }),
      )
      .min(1),
  })
  .refine((u) => u.email || u.phone, {
    message: 'Give an email or a phone number',
    path: ['email'],
  });
type CreateUserInput = z.infer<typeof createUserSchema>;

@Controller('users')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Roles(...SETUP_ROLES)
  list(@CurrentUser() user: AuthUser) {
    return this.prisma.user.findMany({
      where: { schoolId: user.schoolId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        isActive: true,
        lastLoginAt: true,
        roles: { select: { role: true, campusId: true } },
      },
    });
  }

  @Post()
  @Roles(...SETUP_ROLES)
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createUserSchema)) body: CreateUserInput,
  ) {
    const isOwner = user.roles.some((g) => g.role === Role.OWNER);
    if (!isOwner && body.roles.some((g) => g.role === Role.OWNER)) {
      throw new ForbiddenException('Only an owner can create another owner');
    }
    const campusIds = body.roles
      .map((g) => g.campusId)
      .filter((id): id is string => id !== null);
    if (campusIds.length) {
      const count = await this.prisma.campus.count({
        where: { id: { in: campusIds }, schoolId: user.schoolId },
      });
      if (count !== new Set(campusIds).size) {
        throw new NotFoundException('Campus not found');
      }
    }

    const created = await this.prisma.user.create({
      data: {
        schoolId: user.schoolId,
        name: body.name,
        email: body.email,
        phone: body.phone,
        passwordHash: await bcrypt.hash(body.password, 12),
        roles: { create: body.roles },
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        roles: { select: { role: true, campusId: true } },
      },
    });
    await this.audit.record(user, 'user.create', 'User', created.id, {
      after: created,
    });
    return created;
  }
}
