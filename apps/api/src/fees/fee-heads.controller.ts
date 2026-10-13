import { Body, Controller, Delete, NotFoundException, Param, Patch } from '@nestjs/common';
import { FeeFrequency } from '@prisma/client';
import { z } from 'zod';
import { assertSchoolWide, FEE_ROLES } from '../common/admin-roles.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser, Permission, RequiresFeature, Roles } from '../common/decorators.js';
import { assertUnused } from '../common/in-use.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';

const updateHeadSchema = z
  .object({
    name: z.string().trim().min(2).max(60).optional(),
    frequency: z.enum(FeeFrequency).optional(),
  })
  .refine((b) => b.name !== undefined || b.frequency !== undefined, 'Nothing to change');
type UpdateHeadInput = z.infer<typeof updateHeadSchema>;

/** Fee heads are shared by every campus, so changing one is for school-wide fee staff. */
const SCHOOL_WIDE = 'Fee heads are shared by every campus; ask a school-wide admin or accountant to change them';

/**
 * Editing and deleting fee heads (SCHOOL-139). Creating and listing them stay
 * with the rest of fee setup in FeesController.
 */
@Controller('fees/heads')
@Permission('fees')
@RequiresFeature('fees')
@Roles(...FEE_ROLES)
export class FeeHeadsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Renames a head or changes how often it is billed (from the next vouchers on). */
  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateHeadSchema)) body: UpdateHeadInput,
  ) {
    assertSchoolWide(user, SCHOOL_WIDE, FEE_ROLES);
    const before = await this.find(user, id);
    const after = await this.prisma.feeHead.update({ where: { id }, data: body });
    await this.audit.record(user, 'fee_head.update', 'FeeHead', id, { before, after });
    return after;
  }

  /** Deletes a head no class amount, concession or voucher uses. */
  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    assertSchoolWide(user, SCHOOL_WIDE, FEE_ROLES);
    const before = await this.find(user, id);
    const where = { feeHeadId: id };
    const [structures, concessions, lines] = await Promise.all([
      this.prisma.feeStructure.count({ where }),
      this.prisma.concession.count({ where }),
      this.prisma.invoiceLine.count({ where }),
    ]);
    assertUnused(before.name, { 'class amount': structures, concession: concessions, 'voucher line': lines });
    await this.prisma.feeHead.delete({ where: { id } });
    await this.audit.record(user, 'fee_head.delete', 'FeeHead', id, { before });
    return { deleted: true };
  }

  private async find(user: AuthUser, id: string) {
    const head = await this.prisma.feeHead.findFirst({ where: { id, schoolId: user.schoolId } });
    if (!head) throw new NotFoundException('Fee head not found');
    return head;
  }
}
