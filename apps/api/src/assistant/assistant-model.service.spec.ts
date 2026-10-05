import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AssistantModel, DEFAULT_MODEL } from './assistant-model.service.js';

describe('AssistantModel', () => {
  it('is off without an API key and says so', async () => {
    const model = new AssistantModel(new ConfigService({}));
    expect(model.enabled).toBe(false);
    expect(model.model).toBe(DEFAULT_MODEL);
    await expect(model.create({ max_tokens: 10, messages: [] })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('is on with a key and takes a model override', () => {
    const model = new AssistantModel(new ConfigService({ ANTHROPIC_API_KEY: 'sk-test', ASSISTANT_MODEL: 'claude-sonnet-5-5' }));
    expect(model.enabled).toBe(true);
    expect(model.model).toBe('claude-sonnet-5-5');
  });
});
