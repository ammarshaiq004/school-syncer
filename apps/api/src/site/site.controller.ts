import { Body, Controller, Get, Header, NotFoundException, Param, Put } from '@nestjs/common';
import { Role } from '@prisma/client';
import { z } from 'zod';
import { SETUP_ROLES } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Permission, Public, Roles } from '../common/decorators.js';
import { RateLimit } from '../common/rate-limit.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { SubscriptionService } from '../platform/subscription.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { defaultSite, publicSite, resolveSite, siteInputSchema, type SiteSource } from './site-config.js';

const saveSchema = z.object({ published: z.boolean(), content: siteInputSchema });
type SaveInput = z.infer<typeof saveSchema>;

const TEACHING = [Role.TEACHER, Role.CLASS_TEACHER];

/** The school's public website: edited in the portal, read by anyone at /s/<slug>. */
@Controller()
@Permission('settings')
export class SiteController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly subscriptions: SubscriptionService,
  ) {}

  /** For the editor: what the school saved, the site it adds up to, and the defaults to reset to. */
  @Get('school/site')
  @Roles(...SETUP_ROLES)
  async get(@CurrentUser() user: AuthUser) {
    const [src, row, school] = await Promise.all([
      this.source(user.schoolId),
      this.prisma.schoolSite.findUnique({ where: { schoolId: user.schoolId } }),
      this.prisma.school.findUniqueOrThrow({ where: { id: user.schoolId }, select: { slug: true, logoUrl: true } }),
    ]);
    return {
      slug: school.slug,
      logoUrl: school.logoUrl,
      published: row?.published ?? false,
      saved: row?.config ?? {},
      config: resolveSite(src, row?.config),
      defaults: defaultSite(src),
    };
  }

  /** Replaces the saved choices. Sections left out go back to their defaults. */
  @Put('school/site')
  @Roles(...SETUP_ROLES)
  async save(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(saveSchema)) body: SaveInput) {
    const before = await this.prisma.schoolSite.findUnique({ where: { schoolId: user.schoolId } });
    const after = await this.prisma.schoolSite.upsert({
      where: { schoolId: user.schoolId },
      create: { schoolId: user.schoolId, published: body.published, config: body.content },
      update: { published: body.published, config: body.content },
    });
    await this.audit.record(user, 'school.site.update', 'SchoolSite', user.schoolId, {
      before: before && { published: before.published },
      after: { published: after.published },
    });
    return { published: after.published, saved: after.config };
  }

  /** The public page. A school that has not published, or whose plan is blocked, has no site. */
  @Public()
  @Get('public/:schoolSlug/site')
  @RateLimit('site', 300, 60_000)
  @Header('Cache-Control', 'public, max-age=30, stale-while-revalidate=120')
  async view(@Param('schoolSlug') slug: string) {
    const school = await this.prisma.school.findUnique({
      where: { slug },
      select: {
        id: true, name: true, slug: true, city: true, phone: true, email: true, logoUrl: true, locale: true, mode: true,
        site: true,
        campuses: { select: { name: true, address: true, phone: true }, orderBy: { name: 'asc' } },
      },
    });
    if (!school?.site?.published) throw new NotFoundException('This school has no website yet');
    const plan = await this.subscriptions.forSchool(school.id);
    if (plan.access === 'blocked') throw new NotFoundException('This school has no website yet');
    const { site, campuses, id, ...profile } = school;
    const counts = await this.counts(id, campuses.length);
    const admissionsOpen = plan.access !== 'read_only' && plan.features.includes('admissions');
    return publicSite(profile, campuses, counts, site.config, admissionsOpen);
  }

  private async source(schoolId: string): Promise<SiteSource> {
    const school = await this.prisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: { name: true, city: true, mode: true, campuses: { select: { name: true, address: true }, orderBy: { name: 'asc' } } },
    });
    return { ...school, counts: await this.counts(schoolId, school.campuses.length) };
  }

  private async counts(schoolId: string, campuses: number): Promise<SiteSource['counts']> {
    const [students, teachers] = await Promise.all([
      this.prisma.student.count({ where: { schoolId, status: 'ACTIVE' } }),
      this.prisma.user.count({ where: { schoolId, isActive: true, roles: { some: { role: { in: TEACHING } } } } }),
    ]);
    return { students, teachers, campuses };
  }
}
