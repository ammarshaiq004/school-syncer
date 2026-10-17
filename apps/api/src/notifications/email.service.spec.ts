import { NotificationStatus } from '@prisma/client';
import { PermanentJobError, type JobInfo, type JobsService } from '../jobs/jobs.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { EMAIL_QUEUE, EmailService, emailConfig } from './email.service.js';

const sendMail = vi.fn();
vi.mock('nodemailer', () => ({ createTransport: vi.fn(() => ({ sendMail })) }));

const job = { id: 'j1', queue: EMAIL_QUEUE, attempt: 1 } as JobInfo;

function setup(log: Record<string, unknown> | null = { id: 'l1', to: 'owner@demo.pk', template: 'platform.billing', status: NotificationStatus.QUEUED }) {
  const prisma = {
    notificationLog: {
      create: vi.fn().mockResolvedValue({ id: 'l1' }),
      findUnique: vi.fn().mockResolvedValue(log),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  const jobs = { register: vi.fn(), enqueue: vi.fn() };
  const service = new EmailService(prisma as unknown as PrismaService, jobs as unknown as JobsService);
  return { service, prisma, jobs };
}

afterEach(() => {
  vi.unstubAllEnvs();
  sendMail.mockReset();
});

describe('emailConfig', () => {
  it('needs both the SMTP address and the sender', () => {
    expect(emailConfig({})).toBeNull();
    expect(emailConfig({ EMAIL_SMTP_URL: 'smtp://x' })).toBeNull();
    expect(emailConfig({ EMAIL_SMTP_URL: ' smtp://x ', EMAIL_FROM: 'a@b.pk' })).toEqual({ url: 'smtp://x', from: 'a@b.pk' });
  });
});

describe('EmailService', () => {
  it('queues one email per address and subject, skipping non-addresses', async () => {
    const { service, prisma, jobs } = setup();
    const email = { subject: 'Bill', text: 'Pay', template: 'platform.billing' };
    const queued = await service.send('s1', [
      { ...email, to: 'Owner@Demo.pk' },
      { ...email, to: 'owner@demo.pk' },
      { ...email, to: 'not-an-email' },
    ]);
    expect(queued).toBe(1);
    expect(prisma.notificationLog.create.mock.calls[0][0].data).toMatchObject({ to: 'owner@demo.pk', sender: 'log' });
    expect(jobs.enqueue).toHaveBeenCalledWith(EMAIL_QUEUE, { logId: 'l1', subject: 'Bill', text: 'Pay' }, expect.any(Object));
  });

  it('registers its queue, and marks the log failed after the last attempt', async () => {
    const { service, prisma, jobs } = setup();
    service.onModuleInit();
    const handlers = jobs.register.mock.calls[0][1];
    expect(handlers.scrub({ logId: 'l1', subject: 's', text: 't' })).toEqual({ logId: 'l1' });
    await handlers.failed({ logId: 'l1' }, job, new Error('timeout'));
    expect(prisma.notificationLog.updateMany).toHaveBeenCalledWith({
      where: { id: 'l1', status: NotificationStatus.QUEUED },
      data: { status: NotificationStatus.FAILED, attempts: 1, error: 'timeout' },
    });
  });

  it('only logs when no SMTP server is set up', async () => {
    const { service, prisma } = setup();
    await service.deliver({ logId: 'l1', subject: 'Bill', text: 'Pay' }, job);
    expect(prisma.notificationLog.update).toHaveBeenLastCalledWith({
      where: { id: 'l1' },
      data: { status: NotificationStatus.LOGGED, sender: 'log' },
    });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('skips logs that are gone or already handled', async () => {
    const { service, prisma } = setup(null);
    await service.deliver({ logId: 'l1', subject: 'Bill', text: 'Pay' }, job);
    expect(prisma.notificationLog.update).not.toHaveBeenCalled();
  });

  it('sends over SMTP and records the provider id', async () => {
    vi.stubEnv('EMAIL_SMTP_URL', 'smtp://mail.example.pk');
    vi.stubEnv('EMAIL_FROM', 'billing@schoolsyncer.pk');
    sendMail.mockResolvedValue({ messageId: 'm1' });
    const { service, prisma } = setup();
    await service.deliver({ logId: 'l1', subject: 'Bill', text: 'Pay' }, job);
    expect(sendMail).toHaveBeenCalledWith({ from: 'billing@schoolsyncer.pk', to: 'owner@demo.pk', subject: 'Bill', text: 'Pay' });
    expect(prisma.notificationLog.update).toHaveBeenLastCalledWith({
      where: { id: 'l1' },
      data: expect.objectContaining({ status: NotificationStatus.SENT, providerMessageId: 'm1' }),
    });
  });

  it('does not retry a rejected address, but retries other failures', async () => {
    vi.stubEnv('EMAIL_SMTP_URL', 'smtp://mail.example.pk');
    vi.stubEnv('EMAIL_FROM', 'billing@schoolsyncer.pk');
    const { service } = setup();
    sendMail.mockRejectedValueOnce(Object.assign(new Error('550 no such user'), { responseCode: 550 }));
    await expect(service.deliver({ logId: 'l1', subject: 'Bill', text: 'Pay' }, job)).rejects.toBeInstanceOf(PermanentJobError);
    sendMail.mockRejectedValueOnce(new Error('connection reset'));
    const retry = service.deliver({ logId: 'l1', subject: 'Bill', text: 'Pay' }, job);
    await expect(retry).rejects.toThrow('connection reset');
    await expect(retry).rejects.not.toBeInstanceOf(PermanentJobError);
  });
});
