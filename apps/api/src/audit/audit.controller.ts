import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { SETUP_ROLES } from '../common/admin-roles.js';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Permission, Roles } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { actorOf, auditWhere } from './audit-query.js';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  // Rejects impossible days such as 2026-02-31, which would otherwise reach the date maths.
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
  }, 'Use a real date');

const listSchema = z
  .object({
    entity: z.string().max(80).optional(),
    userId: z.string().max(40).optional(),
    action: z.string().max(80).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'Use a from date on or before the to date',
    path: ['from'],
  });
type ListQuery = z.infer<typeof listSchema>;

/** The school's own audit log (System settings > Audit log). */
@Controller('audit')
@Roles(...SETUP_ROLES)
@Permission('audit')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listSchema)) query: ListQuery,
  ) {
    const where = auditWhere(user.schoolId, query);
    const [total, rows] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    const userIds = [...new Set(rows.map((r) => r.userId).filter((id): id is string => id !== null))];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds }, schoolId: user.schoolId },
          select: { id: true, name: true },
        })
      : [];
    const names = new Map(users.map((u) => [u.id, u.name]));
    return {
      items: rows.map(({ schoolId: _school, ...r }) => ({ ...r, actor: actorOf(r, names) })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** Values for the filter dropdowns. */
  @Get('facets')
  async facets(@CurrentUser() user: AuthUser) {
    const [entities, actions] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: { schoolId: user.schoolId },
        distinct: ['entity'],
        select: { entity: true },
        orderBy: { entity: 'asc' },
      }),
      this.prisma.auditLog.findMany({
        where: { schoolId: user.schoolId },
        distinct: ['action'],
        select: { action: true },
        orderBy: { action: 'asc' },
      }),
    ]);
    return { entities: entities.map((e) => e.entity), actions: actions.map((a) => a.action) };
  }
}
