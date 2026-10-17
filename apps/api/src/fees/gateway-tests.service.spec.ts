import { CheckoutStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { FeeCorrectionsService } from './fee-corrections.service.js';
import { GatewayTestsService, runStatus } from './gateway-tests.service.js';
import { gatewayConfig } from './gateways/gateway-config.js';
import { withSchoolAccounts } from './gateways/school-accounts.js';
import type { OnlinePaymentsService } from './online-payments.service.js';

const at = new Date('2026-10-15T05:00:00Z');
const later = (s: number) => new Date(at.getTime() + s * 1000);

describe('runStatus', () => {
  const open = { reversedAt: null, outcome: null };
  const checkout = (status: CheckoutStatus, expiresAt = later(3600)) => ({ status, expiresAt });

  it('follows the checkout until the run is closed', () => {
    expect(runStatus(open, checkout(CheckoutStatus.PENDING), at)).toBe('WAITING');
    expect(runStatus(open, checkout(CheckoutStatus.PENDING, later(-1)), at)).toBe('EXPIRED');
    expect(runStatus(open, checkout(CheckoutStatus.PAID), at)).toBe('PAID');
    expect(runStatus(open, checkout(CheckoutStatus.REVIEW), at)).toBe('REVIEW');
    expect(runStatus(open, checkout(CheckoutStatus.FAILED), at)).toBe('FAILED');
    expect(runStatus({ reversedAt: at, outcome: 'reversed' }, checkout(CheckoutStatus.PAID), at)).toBe('REVERSED');
    expect(runStatus({ reversedAt: null, outcome: 'cancelled' }, checkout(CheckoutStatus.FAILED), at)).toBe('CANCELLED');
    expect(runStatus(open, null, at)).toBe('CANCELLED');
  });

  it('still shows money that arrived after a cancel', () => {
    expect(runStatus({ reversedAt: null, outcome: 'cancelled' }, checkout(CheckoutStatus.PAID), at)).toBe('PAID');
    expect(runStatus({ reversedAt: null, outcome: 'cancelled' }, checkout(CheckoutStatus.REVIEW), at)).toBe('REVIEW');
  });
});

function service(mode: 'mock' | 'sandbox' | 'off', prisma: Partial<Record<string, unknown>> = {}) {
  const config = gatewayConfig({ PAYMENTS_MODE: mode });
  const online = {
    config,
    configFor: async () => withSchoolAccounts(config, []),
  } as unknown as OnlinePaymentsService;
  return new GatewayTestsService(prisma as unknown as PrismaService, online, {} as FeeCorrectionsService);
}
const admin = { sub: 'admin-1', name: 'Staff', platform: true as const };

describe('GatewayTestsService', () => {
  it('refuses to start when payments are off, the school is unknown, or the gateway has no account', async () => {
    await expect(service('off').start(admin, { schoolId: 's', provider: 'JAZZCASH', amount: 10 })).rejects.toThrow(/switched off/);
    const none = { school: { findUnique: async () => null } };
    await expect(service('mock', none).start(admin, { schoolId: 's', provider: 'JAZZCASH', amount: 10 })).rejects.toThrow(/School not found/);
    const school = { school: { findUnique: async () => ({ id: 's', name: 'School' }) } };
    // Sandbox with no server account and no school account.
    await expect(service('sandbox', school).start(admin, { schoolId: 's', provider: 'EASYPAISA', amount: 10 })).rejects.toThrow(/not set up/);
  });

  it('does not touch closed or missing runs', async () => {
    const closed = { gatewayTestRun: { findUnique: async () => ({ id: 'r', finishedAt: at, checkout: null }) } };
    await expect(service('mock', closed).cancel(admin, 'r')).rejects.toThrow(/closed/);
    await expect(service('mock', closed).simulate('r', true)).rejects.toThrow(/closed/);
    const missing = { gatewayTestRun: { findUnique: async () => null } };
    await expect(service('mock', missing).get('r')).rejects.toThrow(/not found/);
    await expect(service('mock', missing).reverse(admin, 'r')).rejects.toThrow(/not found/);
  });

  it('only reverses a paid, unreversed run', async () => {
    const unpaid = { gatewayTestRun: { findUnique: async () => ({ id: 'r', reversedAt: null, checkout: { payment: null } }) } };
    await expect(service('mock', unpaid).reverse(admin, 'r')).rejects.toThrow(/Cancel it instead/);
    const done = { gatewayTestRun: { findUnique: async () => ({ id: 'r', reversedAt: at }) } };
    await expect(service('mock', done).reverse(admin, 'r')).rejects.toThrow(/already reversed/);
  });

  it('only simulates in mock mode on an open checkout', async () => {
    const run = (status: CheckoutStatus) => ({
      gatewayTestRun: { findUnique: async () => ({ id: 'r', finishedAt: null, checkout: { id: 'c', status } }) },
    });
    await expect(service('sandbox', run(CheckoutStatus.PENDING)).simulate('r', true)).rejects.toThrow(/mock mode/);
    await expect(service('mock', run(CheckoutStatus.PAID)).simulate('r', true)).rejects.toThrow(/no longer open/);
  });

  it('shows a run with its timings, events and receipt', () => {
    const view = service('mock').view({
      id: 'r',
      schoolId: 's',
      provider: 'JAZZCASH',
      mode: 'sandbox',
      account: 'school',
      amount: 10,
      invoiceId: 'i',
      checkoutId: 'c',
      startedById: 'admin-1',
      callbackAt: later(42),
      events: [{ at: later(42).toISOString(), kind: 'ipn', verified: true, status: 'PAID', code: '000' }],
      reversedAt: null,
      finishedAt: null,
      outcome: null,
      createdAt: at,
      school: { id: 's', name: 'School' },
      startedBy: { name: 'Staff' },
      checkout: {
        id: 'c',
        status: CheckoutStatus.PAID,
        txnRef: 'T1',
        consumerNumber: null,
        providerRef: 'RRN',
        responseCode: '000',
        message: null,
        expiresAt: later(3600),
        payment: { id: 'p', receiptNo: 'R-1', receivedAt: later(43), reversedAt: null },
      },
    });
    expect(view).toMatchObject({
      status: 'PAID',
      callbackSeen: true,
      startedBy: 'Staff',
      receipt: { receiptNo: 'R-1', reversed: false },
      timings: { toCallback: 42, toPaid: 43, reversedAt: null },
    });
    expect(view.events).toHaveLength(1);
  });
});
