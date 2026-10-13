import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentMethod } from '@prisma/client';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { Public } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PaymentsService } from './payments.service.js';

const PROVIDERS: Record<string, PaymentMethod> = {
  jazzcash: PaymentMethod.JAZZCASH,
  easypaisa: PaymentMethod.EASYPAISA,
  onebill: PaymentMethod.ONEBILL,
  card: PaymentMethod.CARD,
};

const webhookSchema = z.object({
  voucherNo: z.string().min(1),
  amount: z.number().int().positive(),
  reference: z.string().min(1).max(80),
});

/**
 * Payment confirmations from gateways. Each provider posts a normalised body
 * signed with HMAC-SHA256 of the raw body in the X-Signature header, using the
 * secret in PAYMENT_WEBHOOK_SECRET_<PROVIDER>. Provider-specific adapters
 * (JazzCash, Easypaisa, 1Bill) translate their own callbacks into this shape
 * once merchant accounts are set up.
 */
@Controller('payments/webhook')
export class PaymentWebhookController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post(':provider')
  @HttpCode(200)
  async receive(
    @Param('provider') provider: string,
    @Headers('x-signature') signature: string | undefined,
    @Req() req: RawBodyRequest<Request>,
    @Body(new ZodValidationPipe(webhookSchema)) body: z.infer<typeof webhookSchema>,
  ) {
    const method = PROVIDERS[provider];
    if (!method) throw new NotFoundException('Unknown payment provider');
    const secret = this.config.get<string>(`PAYMENT_WEBHOOK_SECRET_${provider.toUpperCase()}`);
    if (!secret) throw new BadRequestException('Provider is not configured');
    if (!signature || !req.rawBody || !verify(req.rawBody, signature, secret)) {
      throw new UnauthorizedException('Bad signature');
    }

    const invoice = await this.prisma.invoice.findUnique({ where: { voucherNo: body.voucherNo } });
    if (!invoice) throw new NotFoundException('Voucher not found');
    const { payment, duplicate } = await this.payments.record(invoice.schoolId, {
      invoiceId: invoice.id,
      amount: body.amount,
      method,
      reference: body.reference,
      // The gateway's transaction id: a replayed callback is counted once.
      idempotencyKey: `${method}:${body.reference}`,
    });
    return { receiptNo: payment.receiptNo, duplicate };
  }
}

export function sign(raw: Buffer | string, secret: string) {
  return createHmac('sha256', secret).update(raw).digest('hex');
}

function verify(raw: Buffer, signature: string, secret: string) {
  const expected = Buffer.from(sign(raw, secret));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
