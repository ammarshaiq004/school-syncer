import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sealSecrets, secretKey } from '../fees/gateways/school-accounts.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AssistantModel, DEFAULT_MODEL } from './assistant-model.service.js';

const KEY = 'a'.repeat(64);

function make(env: Record<string, string>, sealed: string | null = null) {
  process.env.PAYMENTS_SECRET_KEY = KEY;
  const prisma = { platformAiKey: { findUnique: vi.fn().mockResolvedValue(sealed ? { sealed } : null) } };
  return new AssistantModel(new ConfigService(env), prisma as unknown as PrismaService);
}

describe('AssistantModel', () => {
  it('is off without a key and says so', async () => {
    const model = make({});
    expect(await model.available()).toBe(false);
    expect(model.model).toBe(DEFAULT_MODEL);
    await expect(model.create({ max_tokens: 10, messages: [] })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('is on with the server key and takes a model override', async () => {
    const model = make({ ANTHROPIC_API_KEY: 'sk-env', ASSISTANT_MODEL: 'claude-sonnet-5-5' });
    expect(await model.keySource()).toMatchObject({ key: 'sk-env', source: 'env' });
    expect(model.model).toBe('claude-sonnet-5-5');
  });

  it('prefers the key saved in the console, and drops back to the server key if it cannot be opened', async () => {
    const sealed = sealSecrets({ key: 'sk-console' }, secretKey(KEY)!);
    expect(await make({ ANTHROPIC_API_KEY: 'sk-env' }, sealed).keySource()).toMatchObject({ key: 'sk-console', source: 'console' });
    expect(await make({ ANTHROPIC_API_KEY: 'sk-env' }, 'v2:00000000:AAAA').keySource()).toMatchObject({ key: 'sk-env', source: 'env' });
  });

  it('notices a changed key after refresh()', async () => {
    const model = make({});
    expect(await model.available()).toBe(false);
    (model as unknown as { prisma: PrismaService }).prisma.platformAiKey.findUnique = vi
      .fn()
      .mockResolvedValue({ sealed: sealSecrets({ key: 'sk-new' }, secretKey(KEY)!) }) as never;
    expect(await model.available()).toBe(false); // still cached
    model.refresh();
    expect(await model.available()).toBe(true);
  });
});
