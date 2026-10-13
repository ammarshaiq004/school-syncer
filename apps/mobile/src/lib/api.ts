/**
 * Inlined when the app is bundled. Development falls back to a local API; a
 * release build without it cannot reach any server, so it says so loudly.
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? (__DEV__ ? 'http://localhost:4000/api' : '');
if (!API_URL) {
  console.error('EXPO_PUBLIC_API_URL was not set when this app was built; it cannot reach the SchoolSyncer API.');
}

export type Role =
  | 'OWNER'
  | 'PRINCIPAL'
  | 'ADMIN'
  | 'ACCOUNTANT'
  | 'TEACHER'
  | 'CLASS_TEACHER'
  | 'STAFF'
  | 'PARENT'
  | 'STUDENT';

export interface SessionUser {
  sub: string;
  schoolId: string;
  name: string;
  roles: { role: Role; campusId: string | null }[];
  /** The school issued this password: only the change-password screen works until it is replaced. */
  mustChangePassword?: boolean;
}

let token: string | null = null;
export const setApiToken = (t: string | null) => {
  token = t;
};

/** Calls the API and returns the JSON body; throws the API's message on failure. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new Error('Could not reach the school server. Check your internet connection.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const issues: { message: string }[] | undefined = data?.issues;
    const message = issues?.length
      ? issues.map((i) => i.message).join(', ')
      : Array.isArray(data?.message)
        ? data.message.join(', ')
        : data?.message;
    throw new ApiError(res.status, message ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
