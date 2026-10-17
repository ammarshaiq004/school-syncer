import type { JwtService } from '@nestjs/jwt';

type Env = Record<string, string | undefined>;

/** A comma-separated list of previous secrets, blanks dropped. */
export const previousSecrets = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

/**
 * Verifies a session token with JWT_SECRET and, during a rotation window,
 * with JWT_SECRET_PREVIOUS (verification only: new tokens are always signed
 * with JWT_SECRET). Remove the previous secret once JWT_EXPIRES_IN has passed
 * since the switch and every old token has expired. Throws the current
 * secret's error when nothing verifies it.
 */
export async function verifySessionToken<T extends object>(jwt: JwtService, token: string, env: Env = process.env): Promise<T> {
  try {
    return await jwt.verifyAsync<T>(token);
  } catch (error) {
    for (const secret of previousSecrets(env.JWT_SECRET_PREVIOUS)) {
      try {
        return await jwt.verifyAsync<T>(token, { secret });
      } catch {
        // Try the next one.
      }
    }
    throw error;
  }
}

/**
 * The secret that signs file and photo links, and the ones still accepted.
 * FILE_SIGNING_SECRET when set (rotated with FILE_SIGNING_SECRET_PREVIOUS),
 * otherwise JWT_SECRET, whose rotation then also covers file links.
 */
export function fileSigningSecrets(env: Env = process.env): { current: string; previous: string[] } {
  const own = env.FILE_SIGNING_SECRET?.trim();
  if (own) return { current: own, previous: previousSecrets(env.FILE_SIGNING_SECRET_PREVIOUS) };
  const jwt = env.JWT_SECRET?.trim();
  if (!jwt) throw new Error('JWT_SECRET is not set');
  return { current: jwt, previous: previousSecrets(env.JWT_SECRET_PREVIOUS) };
}
