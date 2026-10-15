import { appEnvKeys } from '../app-version/app-release.js';
import { compareVersions, isVersion } from '../app-version/version.js';
import { secretKey } from '../fees/gateways/school-accounts.js';

type Env = Record<string, unknown>;

/** The placeholders shipped in .env.example and CI, never acceptable in production. */
const KNOWN_SECRETS = ['change-me-to-a-long-random-string', 'ci-only-secret'];
const MIN_SECRET_LENGTH = 32;

const text = (env: Env, key: string) => {
  const v = env[key];
  return typeof v === 'string' ? v.trim() : v === undefined || v === null ? '' : String(v);
};

function secretProblem(name: string, value: string): string | null {
  if (!value) return `${name} is required`;
  if (KNOWN_SECRETS.includes(value) || /change-?me/i.test(value)) return `${name} is still the example placeholder`;
  if (value.length < MIN_SECRET_LENGTH) return `${name} must be at least ${MIN_SECRET_LENGTH} characters (e.g. \`openssl rand -hex 32\`)`;
  return null;
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

  // Mobile app version defaults (the console can override them).
  for (const platform of ['IOS', 'ANDROID'] as const) {
    const keys = appEnvKeys(platform);
    const min = text(env, keys.minVersion);
    const latest = text(env, keys.latestVersion);
    for (const [key, value] of [[keys.minVersion, min], [keys.latestVersion, latest]]) {
      if (value && !isVersion(value)) problems.push(`${key} must be a version like 1.4.0 (got "${value}")`);
    }
    if (isVersion(min) && isVersion(latest) && compareVersions(latest, min) < 0) {
      problems.push(`${keys.latestVersion} cannot be below ${keys.minVersion}`);
    }
  }

  if (text(env, 'NODE_ENV') === 'production') {
    if (!text(env, 'DATABASE_URL')) problems.push('DATABASE_URL is required');
    const jwt = text(env, 'JWT_SECRET');
    const jwtProblem = secretProblem('JWT_SECRET', jwt);
    if (jwtProblem) problems.push(jwtProblem);
    // Signed download links for locally stored files; S3 signs its own.
    if (text(env, 'STORAGE_DRIVER') !== 's3') {
      const signing = text(env, 'FILE_SIGNING_SECRET');
      const signingProblem = secretProblem('FILE_SIGNING_SECRET', signing);
      if (signingProblem) problems.push(signingProblem);
      else if (signing === jwt) problems.push('FILE_SIGNING_SECRET must differ from JWT_SECRET');
    }
    for (const key of ['API_PUBLIC_URL', 'WEB_PUBLIC_URL']) {
      const problem = publicUrlProblem(key, text(env, key));
      if (problem) problems.push(problem);
    }
    if (mode === 'mock') {
      problems.push('PAYMENTS_MODE=mock is for development only: it lets parents approve their own payments. Use "off", "sandbox" or "live"');
    }
    if ((mode === 'sandbox' || mode === 'live') && !secretKey(text(env, 'PAYMENTS_SECRET_KEY'))) {
      problems.push(`PAYMENTS_SECRET_KEY is required when PAYMENTS_MODE=${mode} (64 hex characters or a 32+ character passphrase)`);
    }
  }

  if (problems.length) {
    throw new Error(`Invalid environment, the API will not start:\n- ${problems.join('\n- ')}`);
  }
  return env;
}
