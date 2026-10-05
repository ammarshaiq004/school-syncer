import { All, Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import { CheckoutStatus, Role } from '@prisma/client';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { FEE_ROLES } from '../common/admin-roles.js';
import type { AuthUser } from '../common/auth-user.js';
import { AllowWhenReadOnly, CurrentUser, Permission, Public, RequiresFeature, Roles } from '../common/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { easypaisaConfirm } from './gateways/easypaisa.js';
import type { CheckoutAction } from './gateways/gateway-types.js';
import { onebillAuthorised, onebillInquiryResponse, ONEBILL, type OnebillPaymentRequest } from './gateways/onebill.js';
import { ONLINE_PROVIDERS, OnlinePaymentsService } from './online-payments.service.js';

const checkoutSchema = z.object({
  provider: z.enum(ONLINE_PROVIDERS),
  /** Easypaisa prefills the wallet number when given. */
  mobile: z
    .string()
    .trim()
    .regex(/^03\d{9}$/, 'Use a mobile number like 03001234567')
    .optional(),
});
const mockSchema = z.object({ approve: z.boolean() });

/** Parents paying their children's vouchers online. */
@Controller('parent')
@Roles(Role.PARENT)
// Paying their own vouchers only needs to see them.
@Permission('fees', 'view')
@RequiresFeature('online_payments')
export class ParentPaymentsController {
  constructor(private readonly online: OnlinePaymentsService) {}

  /** Which gateways the parent can choose, and whether checkouts are simulated. */
  @Get('payment-options')
  options() {
    return this.online.options();
  }

  // A school behind on its SchoolSyncer bill still collects its own fees.
  @Post('invoices/:id/checkout')
  @AllowWhenReadOnly()
  checkout(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(checkoutSchema)) body: z.infer<typeof checkoutSchema>,
  ) {
    return this.online.start(user, id, body.provider, { mobile: body.mobile });
  }

  @Get('payments/:id')
  payment(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.online.get(user, id);
  }

  /** Mock mode: approve or decline a checkout as the gateway would. */
  @Post('payments/:id/mock')
  @AllowWhenReadOnly()
  @HttpCode(200)
  mock(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(mockSchema)) body: z.infer<typeof mockSchema>,
  ) {
    return this.online.mockComplete(user, id, body.approve);
  }
}

/** The fee office's view of online checkouts. */
@Controller('fees/online-payments')
@Roles(...FEE_ROLES)
@Permission('fees')
@RequiresFeature('fees')
export class OnlinePaymentsAdminController {
  constructor(private readonly online: OnlinePaymentsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('status') status?: string, @Query('provider') provider?: string) {
    return this.online.list(user.schoolId, {
      status: Object.values(CheckoutStatus).find((s) => s === status),
      provider: ONLINE_PROVIDERS.find((p) => p === provider),
    });
  }
}

/** HTML that posts a form straight on, for gateway hand-offs that must happen in the browser. */
export function autoPostPage(action: CheckoutAction & { kind: 'form' }, title: string) {
  const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  const inputs = Object.entries(action.fields)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title></head>
<body onload="document.forms[0].submit()"><form method="post" action="${esc(action.url)}">${inputs}
<noscript><button type="submit">Continue</button></noscript></form><p>Taking you to ${esc(title)}...</p></body></html>`;
}

/**
 * What the gateways call. None of it is signed in as anyone: JazzCash posts
 * are checked against their secure hash, Easypaisa outcomes are confirmed
 * through its inquiry API, and 1LINK calls carry the biller's credentials.
 */
@Controller('payments')
@Public()
export class PaymentGatewayController {
  constructor(private readonly online: OnlinePaymentsService) {}

  private landing(res: Response, invoiceId?: string, checkoutId?: string) {
    const web = this.online.config.webUrl;
    res.redirect(
      303,
      invoiceId ? `${web}/parent/invoices/${invoiceId}?payment=${checkoutId}` : `${web}/parent/invoices?payment=unverified`,
    );
  }

  /** The parent's browser coming back from JazzCash, carrying the signed result. */
  @Post('return/jazzcash')
  async jazzcash(@Body() body: Record<string, unknown>, @Res() res: Response) {
    const checkout = await this.online.jazzcashReturn(body ?? {});
    this.landing(res, checkout?.invoiceId, checkout?.id);
  }

  /** Easypaisa's first redirect: hand the auth_token back to Confirm.jsf. */
  @All('return/easypaisa')
  easypaisaToken(@Req() req: Request, @Res() res: Response) {
    const token = String(req.query.auth_token ?? (req.body as Record<string, unknown> | undefined)?.auth_token ?? '');
    if (!token) return this.landing(res);
    res.type('html').send(autoPostPage(easypaisaConfirm(this.online.config, token), 'Easypaisa'));
  }

  /** Easypaisa's final redirect. Its status is only a hint; the inquiry decides. */
  @All('return/easypaisa/done')
  async easypaisaDone(@Req() req: Request, @Res() res: Response) {
    const params = { ...(req.body as Record<string, unknown> | undefined), ...req.query };
    const ref = String(params.orderRefNumber ?? params.orderRefNum ?? '');
    const checkout = ref ? await this.online.easypaisaCheck(ref) : null;
    this.landing(res, checkout?.invoiceId, checkout?.id);
  }

  /**
   * Easypaisa's instant payment notification. Only used to learn which order
   * changed: the order reference comes from the query or the last part of the
   * notification URL, and the inquiry API gives the actual status.
   */
  @All('ipn/easypaisa')
  @HttpCode(200)
  async easypaisaIpn(@Req() req: Request) {
    const params = { ...(req.body as Record<string, unknown> | undefined), ...req.query };
    let ref = String(params.orderRefNumber ?? params.orderRefNum ?? params.orderId ?? '');
    if (!ref && typeof params.url === 'string') ref = params.url.split('?')[0].split('/').filter(Boolean).pop() ?? '';
    const checkout = /^[A-Z0-9]{6,30}$/.test(ref) ? await this.online.easypaisaCheck(ref) : null;
    return { received: Boolean(checkout), status: checkout?.status ?? null };
  }

  @Post('1bill/bill-inquiry')
  @HttpCode(200)
  onebillInquiry(
    @Headers('username') username: string | undefined,
    @Headers('password') password: string | undefined,
    @Body() body: { consumer_number?: string } | undefined,
  ) {
    if (!onebillAuthorised(this.online.config, username, password)) return onebillInquiryResponse(null, ONEBILL.SERVICE_FAIL);
    return this.online.onebillInquiry(body?.consumer_number);
  }

  @Post('1bill/bill-payment')
  @HttpCode(200)
  onebillPayment(
    @Headers('username') username: string | undefined,
    @Headers('password') password: string | undefined,
    @Body() body: OnebillPaymentRequest | undefined,
  ) {
    if (!onebillAuthorised(this.online.config, username, password)) {
      return { response_Code: ONEBILL.SERVICE_FAIL, Identification_parameter: '', reserved: '' };
    }
    return this.online.onebillPayment(body ?? {});
  }
}

