import { randomBytes } from 'node:crypto';
import { validateEnv } from './env.validation.js';

const random = () => randomBytes(32).toString('hex');

const production = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://u:p@db:5432/schoolsyncer',
  JWT_SECRET: random(),
  FILE_SIGNING_SECRET: random(),
  API_PUBLIC_URL: 'https://api.schoolsyncer.pk',
  WEB_PUBLIC_URL: 'https://app.schoolsyncer.pk',
  PAYMENTS_MODE: 'off',
};

const problemsOf = (env: Record<string, string | undefined>) => {
  try {
    validateEnv(env);
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};

describe('validateEnv', () => {
  it('accepts the development and CI defaults', () => {
    expect(problemsOf({ JWT_SECRET: 'ci-only-secret' })).toBe('');
    expect(problemsOf({ JWT_SECRET: 'change-me-to-a-long-random-string', PAYMENTS_MODE: 'mock', NODE_ENV: 'test' })).toBe('');
  });

  it('accepts a complete production setup', () => {
    expect(problemsOf(production)).toBe('');
    expect(problemsOf({ ...production, PAYMENTS_MODE: undefined })).toBe('');
    expect(problemsOf({ ...production, STORAGE_DRIVER: 's3', FILE_SIGNING_SECRET: undefined })).toBe('');
  });

  it('checks the mobile app version defaults', () => {
    expect(problemsOf({ APP_MIN_VERSION_IOS: '1.2.0', APP_LATEST_VERSION_IOS: '1.3', APP_MIN_VERSION_ANDROID: '2' })).toBe('');
    expect(problemsOf({ APP_MIN_VERSION_ANDROID: 'v1.2' })).toContain('APP_MIN_VERSION_ANDROID must be a version like 1.4.0');
    expect(problemsOf({ APP_MIN_VERSION_IOS: '1.5.0', APP_LATEST_VERSION_IOS: '1.4.9' })).toContain(
      'APP_LATEST_VERSION_IOS cannot be below APP_MIN_VERSION_IOS',
    );
  });

  it('refuses mock payments in production', () => {
    expect(problemsOf({ ...production, PAYMENTS_MODE: 'mock' })).toContain('PAYMENTS_MODE=mock is for development only');
  });

  it('refuses weak, placeholder or shared secrets in production', () => {
    expect(problemsOf({ ...production, JWT_SECRET: 'change-me-to-a-long-random-string' })).toContain('JWT_SECRET is still the example placeholder');
    expect(problemsOf({ ...production, JWT_SECRET: 'ci-only-secret' })).toContain('JWT_SECRET is still the example placeholder');
    expect(problemsOf({ ...production, JWT_SECRET: 'short' })).toContain('JWT_SECRET must be at least 32 characters');
    expect(problemsOf({ ...production, JWT_SECRET: undefined })).toContain('JWT_SECRET is required');
    expect(problemsOf({ ...production, FILE_SIGNING_SECRET: undefined })).toContain('FILE_SIGNING_SECRET is required');
    expect(problemsOf({ ...production, FILE_SIGNING_SECRET: production.JWT_SECRET })).toContain('FILE_SIGNING_SECRET must differ from JWT_SECRET');
  });

  it('refuses secrets that are a pattern rather than random', () => {
    expect(problemsOf({ ...production, JWT_SECRET: 'a'.repeat(64) })).toContain('JWT_SECRET is too simple');
    expect(problemsOf({ ...production, PAYMENTS_SECRET_KEY: 'ab'.repeat(32) })).toContain('PAYMENTS_SECRET_KEY is too simple');
    expect(problemsOf({ ...production, PAYMENTS_SECRET_KEY: 'not a key' })).toContain('PAYMENTS_SECRET_KEY is not a valid key');
  });

  it('accepts a rotation in progress and checks its previous secrets', () => {
    const rotating = {
      ...production,
      JWT_SECRET_PREVIOUS: random(),
      FILE_SIGNING_SECRET_PREVIOUS: `${random()},${random()}`,
      PAYMENTS_SECRET_KEY: random(),
      PAYMENTS_SECRET_KEY_PREVIOUS: random(),
    };
    expect(problemsOf(rotating)).toBe('');
    expect(problemsOf({ ...rotating, JWT_SECRET_PREVIOUS: 'short' })).toContain('JWT_SECRET_PREVIOUS must be at least 32 characters');
    expect(problemsOf({ ...rotating, PAYMENTS_SECRET_KEY_PREVIOUS: 'tiny' })).toContain('PAYMENTS_SECRET_KEY_PREVIOUS has a value that is not a valid key');
    expect(problemsOf({ ...rotating, PAYMENTS_SECRET_KEY: undefined })).toContain('PAYMENTS_SECRET_KEY_PREVIOUS is set without PAYMENTS_SECRET_KEY');
  });

  it('refuses a secret reused under another name or as its own previous value', () => {
    const shared = random();
    expect(problemsOf({ ...production, JWT_SECRET: shared, JWT_SECRET_PREVIOUS: shared })).toContain('JWT_SECRET_PREVIOUS must differ from JWT_SECRET');
    expect(problemsOf({ ...production, PAYMENTS_SECRET_KEY: production.JWT_SECRET })).toContain('PAYMENTS_SECRET_KEY must differ from JWT_SECRET');
    expect(problemsOf({ ...production, FILE_SIGNING_SECRET_PREVIOUS: production.JWT_SECRET })).toContain('FILE_SIGNING_SECRET_PREVIOUS must differ from JWT_SECRET');
    expect(problemsOf({ ...production, FILE_SIGNING_SECRET_PREVIOUS: `${shared},${shared}` })).toContain('FILE_SIGNING_SECRET_PREVIOUS lists the same value twice');
  });

  it('checks the error tracker and alert webhook settings', () => {
    expect(problemsOf({ SENTRY_DSN: 'not a dsn' })).toContain('SENTRY_DSN is not a valid DSN');
    expect(problemsOf({ SENTRY_DSN: 'https://abc123@glitchtip.example.pk/4' })).toBe('');
    expect(problemsOf({ ALERT_WEBHOOK_URL: 'nope' })).toContain('ALERT_WEBHOOK_URL is not a valid URL');
    expect(problemsOf({ ALERT_WEBHOOK_URL: 'http://hooks.example.pk/x' })).toBe('');
    expect(problemsOf({ ...production, ALERT_WEBHOOK_URL: 'http://hooks.example.pk/x' })).toContain('ALERT_WEBHOOK_URL must use https');
  });

  it('needs https public addresses and a database in production', () => {
    expect(problemsOf({ ...production, API_PUBLIC_URL: 'http://api.schoolsyncer.pk' })).toContain('API_PUBLIC_URL must use https');
    expect(problemsOf({ ...production, WEB_PUBLIC_URL: 'https://localhost:3000' })).toContain('WEB_PUBLIC_URL must not point at localhost');
    expect(problemsOf({ ...production, WEB_PUBLIC_URL: undefined })).toContain('WEB_PUBLIC_URL is required');
    expect(problemsOf({ ...production, DATABASE_URL: '' })).toContain('DATABASE_URL is required');
  });

  it('needs PAYMENTS_SECRET_KEY for real gateways', () => {
    expect(problemsOf({ ...production, PAYMENTS_MODE: 'live' })).toContain('PAYMENTS_SECRET_KEY is required when PAYMENTS_MODE=live');
    expect(problemsOf({ ...production, PAYMENTS_MODE: 'sandbox', PAYMENTS_SECRET_KEY: 'too short' })).toContain('PAYMENTS_SECRET_KEY');
    expect(problemsOf({ ...production, PAYMENTS_MODE: 'live', PAYMENTS_SECRET_KEY: random() })).toBe('');
  });

  it('lists every problem at once', () => {
    const message = problemsOf({ NODE_ENV: 'production', PAYMENTS_MODE: 'mock' });
    expect(message).toMatch(/^Invalid environment/);
    expect(message.split('\n- ').length).toBeGreaterThan(5);
  });

  it('rejects an unknown payments mode anywhere', () => {
    expect(problemsOf({ PAYMENTS_MODE: 'Live' })).toContain('PAYMENTS_MODE must be one of');
  });

  it('checks the messaging driver and the worker switch', () => {
    expect(problemsOf({ NOTIFY_DRIVER: 'telegram' })).toContain('NOTIFY_DRIVER must be one of');
    expect(problemsOf({ NOTIFY_DRIVER: 'sms' })).toContain('NOTIFY_DRIVER=sms needs SMS_GATEWAY_URL');
    expect(problemsOf({ NOTIFY_DRIVER: 'sms', SMS_GATEWAY_URL: 'https://sms.example.pk/send' })).toBe('');
    expect(problemsOf({ JOBS_WORKER: 'no' })).toContain('JOBS_WORKER must be');
    expect(problemsOf({ JOBS_WORKER: 'off' })).toBe('');
  });
});
