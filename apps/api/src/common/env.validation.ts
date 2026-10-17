import { secretKey } from '../fees/gateways/school-accounts.js';
import { parseDsn } from '../observability/error-reporter.js';
import { previousSecrets } from './signing-secrets.js';

type Env = Record<string, unknown>;

/** The placeholders shipped in .env.example and CI, never acceptable in production. */
const KNOWN_SECRETS = ['change-me-to-a-long-random-string', 'ci-only-secret'];
const MIN_SECRET_LENGTH = 32;
/** Fewer different characters than this ("aaaa...", "abcabc...") is a pattern, not a random secret. */
const MIN_DISTINCT_CHARS = 8;

const text = (env: Env, key: string) => {
  const v = env[key];
  return typeof v === 'string' ? v.trim() : v === undefined || v === null ? '' : String(v);
};

function secretProblem(name: string, value: string): string | null {
  if (!value) return `${name} is required`;
  if (KNOWN_SECRETS.includes(value) || /change-?me/i.test(value)) return `${name} is still the example placeholder`;
  if (value.length < MIN_SECRET_LENGTH) return `${name} must be at least ${MIN_SECRET_LENGTH} characters (e.g. \`openssl rand -hex 32\`)`;
  if (new Set(value).size < MIN_DISTINCT_CHARS) return `${name} is too simple to be secret; generate one with \`openssl rand -hex 32\``;
  return null;
}

/**
 * Every secret the API holds, by name; previous ones (rotation) are lists.
 * Each must be strong and none may be reused under another name: a shared
 * value means one leak exposes both, and rotating one rotates neither.
 */
function secretsProblems(env: Env, mode: string): string[] {
  const problems: string[] = [];
  const named: [string, string][] = [];
  const add = (name: string, value: string, required: boolean) => {
    if (!value && !required) return;
    const problem = secretProblem(name, value);
    if (problem) problems.push(problem);
    else named.push([name, value]);
  };
  add('JWT_SECRET', text(env, 'JWT_SECRET'), true);
  // Signed download links for locally stored files; S3 signs its own.
  add('FILE_SIGNING_SECRET', text(env, 'FILE_SIGNING_SECRET'), text(env, 'STORAGE_DRIVER') !== 's3');
  for (const v of previousSecrets(text(env, 'JWT_SECRET_PREVIOUS'))) add('JWT_SECRET_PREVIOUS', v, true);
  for (const v of previousSecrets(text(env, 'FILE_SIGNING_SECRET_PREVIOUS'))) add('FILE_SIGNING_SECRET_PREVIOUS', v, true);

  const payments = text(env, 'PAYMENTS_SECRET_KEY');
  const needsKey = mode === 'sandbox' || mode === 'live';
  if (!secretKey(payments) && (payments || needsKey)) {
    problems.push(`PAYMENTS_SECRET_KEY is ${needsKey ? `required when PAYMENTS_MODE=${mode}` : 'not a valid key'} (64 hex characters or a 32+ character passphrase)`);
  } else if (payments) {
    add('PAYMENTS_SECRET_KEY', payments, true);
  }
  const previousKeys = previousSecrets(text(env, 'PAYMENTS_SECRET_KEY_PREVIOUS'));
  if (previousKeys.length && !payments) problems.push('PAYMENTS_SECRET_KEY_PREVIOUS is set without PAYMENTS_SECRET_KEY: set the new key too');
  for (const v of previousKeys) {
    if (!secretKey(v)) problems.push('PAYMENTS_SECRET_KEY_PREVIOUS has a value that is not a valid key');
    else add('PAYMENTS_SECRET_KEY_PREVIOUS', v, true);
  }

  for (let i = 0; i < named.length; i++) {
    for (let j = i + 1; j < named.length; j++) {
      if (named[i][1] !== named[j][1]) continue;
      const [a, b] = [named[i][0], named[j][0]];
      problems.push(a === b ? `${a} lists the same value twice` : `${b} must differ from ${a}`);
    }
  }
  return problems;
}

function publicUrlProblem(name: string, value: string): string | null {
  if (!value) return `${name} is required`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return `${name} is not a valid URL`;
  }
  if (url.protocol !== 'https:') return `${name} must use https`;
  if (/^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1?\])$/i.test(url.hostname)) return `${name} must not point at localhost`;
  return null;
}

/**
 * Checks the environment at boot (ConfigModule's `validate`). Development and
 * tests run on the defaults; with NODE_ENV=production the API refuses to start
 * on settings that would be unsafe: placeholder or shared secrets, localhost
 * links, or mock payments, which let parents mark their own vouchers paid.
 * See docs/secrets.md for every secret and how to rotate it.
 */
export function validateEnv(env: Env): Env {
  const problems: string[] = [];
  const mode = text(env, 'PAYMENTS_MODE');
  if (mode && !['mock', 'sandbox', 'live', 'off'].includes(mode)) {
    problems.push(`PAYMENTS_MODE must be one of mock, sandbox, live or off (got "${mode}")`);
  }
  const notify = text(env, 'NOTIFY_DRIVER').toLowerCase();
  if (notify && !['log', 'whatsapp', 'sms'].includes(notify)) {
    problems.push(`NOTIFY_DRIVER must be one of log, whatsapp or sms (got "${notify}")`);
  }
  if (notify === 'sms' && !text(env, 'SMS_GATEWAY_URL')) problems.push('NOTIFY_DRIVER=sms needs SMS_GATEWAY_URL');
  const worker = text(env, 'JOBS_WORKER').toLowerCase();
  if (worker && !['on', 'off'].includes(worker)) problems.push(`JOBS_WORKER must be "on" or "off" (got "${worker}")`);

  const dsn = text(env, 'SENTRY_DSN');
  if (dsn && !parseDsn(dsn)) problems.push('SENTRY_DSN is not a valid DSN (https://<key>@<host>/<project id>)');
  const webhook = text(env, 'ALERT_WEBHOOK_URL');
  if (webhook && !URL.canParse(webhook)) problems.push('ALERT_WEBHOOK_URL is not a valid URL');

  if (text(env, 'NODE_ENV') === 'production') {
    if (!text(env, 'DATABASE_URL')) problems.push('DATABASE_URL is required');
    problems.push(...secretsProblems(env, mode));
    for (const key of ['API_PUBLIC_URL', 'WEB_PUBLIC_URL']) {
      const problem = publicUrlProblem(key, text(env, key));
      if (problem) problems.push(problem);
    }
    if (mode === 'mock') {
      problems.push('PAYMENTS_MODE=mock is for development only: it lets parents approve their own payments. Use "off", "sandbox" or "live"');
    }
    if (webhook && !webhook.startsWith('https://')) problems.push('ALERT_WEBHOOK_URL must use https');
  }

  if (problems.length) {
    throw new Error(`Invalid environment, the API will not start:\n- ${problems.join('\n- ')}`);
  }
  return env;
}
