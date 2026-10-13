import { API_URL } from './env';

/** A JSON call to the e2e API; throws with the response body on an unexpected status. */
export async function call<T = any>(
  method: string,
  path: string,
  { token, body, expect }: { token?: string; body?: unknown; expect?: number } = {},
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (expect ? res.status !== expect : !res.ok) {
    throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(data)}`);
  }
  return data as T;
}

/** Signs in to a school and returns the access token. */
export const schoolLogin = async (schoolSlug: string, login: string, password: string) =>
  (await call<{ accessToken: string }>('POST', '/auth/login', { body: { schoolSlug, login, password } })).accessToken;
