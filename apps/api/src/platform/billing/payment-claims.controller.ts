import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilePurpose, PaymentClaimStatus, PlatformNoticeSeverity, type Prisma, Role } from '@prisma/client';
import { z } from 'zod';
import { SETUP_ROLES } from '../../common/admin-roles.js';
import type { AuthUser, PlatformUser } from '../../common/auth-user.js';
import { dayStart, localDate } from '../../common/dates.js';
import { AllowWhenReadOnly, CurrentAdmin, CurrentUser, Permission, PlatformOnly, Roles } from '../../common/decorators.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { UploadInterceptor } from '../../elearning/files/upload.interceptor.js';
import { FilesService, type UploadedTemp } from '../../elearning/files/files.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PlatformAccessGuard } from '../platform-access.guard.js';
import { logPlatform } from '../platform-audit.js';
import { BillingService } from './billing.service.js';

/** A school may have this many claims waiting for review at once. */
export const MAX_PENDING_CLAIMS = 10;

const claimSchema = z
  .object({
    amount: z.number().int().min(1).max(100_000_000),
    method: z.string().trim().min(2).max(30),
    reference: z.string().trim().max(60).optional(),
    paidOn: z.coerce.date(),
    note: z.string().trim().max(300).optional(),
    proofId: z.string().min(1).optional(),
  })
  .refine((c) => c.reference || c.proofId, { message: 'Add the transaction number or upload the proof', path: ['reference'] });

const approveSchema = z.object({ amount: z.number().int().min(1).max(100_000_000).optional() });
const rejectSchema = z.object({ reason: z.string().trim().min(5).max(500) });
const listSchema = z.object({ status: z.enum(PaymentClaimStatus).optional() });

const include = {
  proof: true,
  payment: { select: { id: true, number: true } },
  school: { select: { id: true, name: true, slug: true } },
} satisfies Prisma.PaymentClaimInclude;

type Claim = Prisma.PaymentClaimGetPayload<{ include: typeof include }>;

const rs = (n: number) => `Rs ${n.toLocaleString('en-PK')}`;

async function view(files: FilesService, c: Claim) {
  const { proof, payment, school, proofId: _proofId, paymentId: _paymentId, ...rest } = c;
  return { ...rest, school, receipt: payment, proof: proof ? await files.link(proof) : null };
}

/**
 * The school says it has paid SchoolSyncer by bank transfer or wallet and
 * attaches the slip (SCHOOL-42). Staff check it in the console, which records
 * the payment and its receipt. Open to read-only schools: paying is how they
 * get out of it.
 */
@Controller('subscription/payment-claims')
@Permission('billing')
@Roles(...SETUP_ROLES, Role.ACCOUNTANT)
export class PaymentClaimsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
  ) {}

  /** A png, jpg, webp or gif, or a pdf, up to 5 MB; returns the file to attach. */
  @Post('proof')
  @AllowWhenReadOnly()
  @UseInterceptors(UploadInterceptor(() => [FilePurpose.PAYMENT_PROOF]))
  proof(@CurrentUser() user: AuthUser, @UploadedFile() temp?: UploadedTemp) {
    return this.files.upload(user, FilePurpose.PAYMENT_PROOF, temp);
  }

  @Get()
  @AllowWhenReadOnly()
  async list(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.paymentClaim.findMany({
      where: { schoolId: user.schoolId },
      include,
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    return Promise.all(rows.map((c) => view(this.files, c)));
  }

  @Post()
  @AllowWhenReadOnly()
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(claimSchema)) body: z.infer<typeof claimSchema>,
  ) {
    const paidOn = localDate(body.paidOn);
    if (paidOn > localDate(new Date())) throw new BadRequestException('The payment date cannot be in the future');
    if (body.proofId) {
      const file = await this.prisma.storedFile.findFirst({
        where: { id: body.proofId, schoolId: user.schoolId, purpose: FilePurpose.PAYMENT_PROOF, uploadedById: user.sub, paymentClaim: null },
        select: { id: true },
      });
      if (!file) throw new BadRequestException('Upload the proof again before sending');
    }
    const waiting = await this.prisma.paymentClaim.count({
      where: { schoolId: user.schoolId, status: PaymentClaimStatus.PENDING },
    });
    if (waiting >= MAX_PENDING_CLAIMS) {
      throw new ConflictException(`${waiting} payments are already waiting to be checked. We will confirm them soon.`);
    }
    const claim = await this.prisma.paymentClaim.create({
      data: {
        schoolId: user.schoolId,
        amount: body.amount,
        method: body.method,
        reference: body.reference || null,
        paidOn: dayStart(paidOn),
        note: body.note || null,
        proofId: body.proofId ?? null,
        createdById: user.sub,
        // A support session acts as the user; say who really sent it.
        createdByName: user.support ? `${user.support.adminName} (SchoolSyncer support, as ${user.name})` : user.name,
      },
      include,
    });
    return view(this.files, claim);
  }
}

/** The console's queue of payments schools say they made. */
@Controller('platform/payment-claims')
@PlatformOnly()
@UseGuards(PlatformAccessGuard)
export class PlatformPaymentClaimsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly billing: BillingService,
  ) {}

  /** Waiting claims by default, oldest first so none is forgotten. */
  @Get()
  async list(@Query(new ZodValidationPipe(listSchema)) query: z.infer<typeof listSchema>) {
    const status = query.status ?? PaymentClaimStatus.PENDING;
    const rows = await this.prisma.paymentClaim.findMany({
      where: { status },
      include,
      orderBy: { createdAt: status === PaymentClaimStatus.PENDING ? 'asc' : 'desc' },
      take: 200,
    });
    return Promise.all(rows.map((c) => view(this.files, c)));
  }

  /** Counts for the console's menu and tabs. */
  @Get('counts')
  async counts() {
    const rows = await this.prisma.paymentClaim.groupBy({ by: ['status'], _count: true });
    return Object.fromEntries(Object.values(PaymentClaimStatus).map((s) => [s, rows.find((r) => r.status === s)?._count ?? 0]));
  }

  /** Records the payment (and its receipt) for what the bank shows: the claimed amount unless staff correct it. */
  @Post(':id/approve')
  async approve(
    @CurrentAdmin() admin: PlatformUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(approveSchema)) body: z.infer<typeof approveSchema>,
  ) {
    const claim = await this.claimed(id, { status: PaymentClaimStatus.APPROVED, reviewedBy: admin.name, reviewedAt: new Date() });
    try {
      const payment = await this.billing.recordPayment(
        claim.schoolId,
        {
          amount: body.amount ?? claim.amount,
          method: claim.method,
          reference: claim.reference,
          receivedOn: claim.paidOn,
          note: claim.note,
        },
        admin.name,
      );
      await this.prisma.paymentClaim.update({ where: { id }, data: { paymentId: payment.id } });
      await logPlatform(this.prisma, admin, 'payment_claim.approve', claim.schoolId, {
        receipt: payment.number,
        claimed: claim.amount,
        amount: payment.amount,
      });
    } catch (error) {
      // Nothing was recorded: put the claim back in the queue.
      await this.prisma.paymentClaim.update({
        where: { id },
        data: { status: PaymentClaimStatus.PENDING, reviewedBy: null, reviewedAt: null },
      });
      throw error;
    }
    return view(this.files, await this.prisma.paymentClaim.findUniqueOrThrow({ where: { id }, include }));
  }

  /** Tells the school why the payment could not be confirmed; it can send the details again. */
  @Post(':id/reject')
  async reject(
    @CurrentAdmin() admin: PlatformUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rejectSchema)) body: z.infer<typeof rejectSchema>,
  ) {
    const claim = await this.claimed(id, {
      status: PaymentClaimStatus.REJECTED,
      rejectReason: body.reason,
      reviewedBy: admin.name,
      reviewedAt: new Date(),
    });
    await this.billing.notify(claim.schoolId, {
      kind: 'payment.rejected',
      severity: PlatformNoticeSeverity.WARNING,
      dedupeKey: `${claim.id}:payment.rejected`,
      title: 'We could not confirm your payment',
      body: `We could not confirm your payment of ${rs(claim.amount)} by ${claim.method}${claim.reference ? ` (${claim.reference})` : ''}. ${body.reason} Please send the payment details again under Plan and billing, or contact SchoolSyncer.`,
    });
    await logPlatform(this.prisma, admin, 'payment_claim.reject', claim.schoolId, { amount: claim.amount, reason: body.reason });
    return view(this.files, await this.prisma.paymentClaim.findUniqueOrThrow({ where: { id }, include }));
  }

  /** Moves a waiting claim to its new status; only one reviewer can win. */
  private async claimed(id: string, data: Prisma.PaymentClaimUpdateManyMutationInput) {
    const claim = await this.prisma.paymentClaim.findUnique({ where: { id } });
    if (!claim) throw new NotFoundException('Payment claim not found');
    const { count } = await this.prisma.paymentClaim.updateMany({ where: { id, status: PaymentClaimStatus.PENDING }, data });
    if (!count) throw new ConflictException('This payment has already been reviewed');
    return claim;
  }
}
