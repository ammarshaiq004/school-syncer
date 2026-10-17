import { APP_HEADERS } from './app-info';

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

/** What the API sends with 426 APP_UPDATE_REQUIRED: this build is below the minimum. */
export interface UpdateRequired {
  message: string;
  minVersion?: string;
  storeUrl?: string;
}

export const APP_UPDATE_REQUIRED = 'APP_UPDATE_REQUIRED';

let onUpdateRequired: ((info: UpdateRequired) => void) | null = null;
/** The update gate listens here, so any refused request shows the "Update required" screen. */
export const setUpdateRequiredHandler = (handler: typeof onUpdateRequired) => {
  onUpdateRequired = handler;
};

/** Calls the API and returns the JSON body; throws the API's message on failure. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...APP_HEADERS,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new Error('Could not reach the school server. Check your internet connection.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 426 && data?.code === APP_UPDATE_REQUIRED) {
      const info: UpdateRequired = { message: data.message, minVersion: data.minVersion, storeUrl: data.storeUrl };
      onUpdateRequired?.(info);
      throw new ApiError(426, info.message, APP_UPDATE_REQUIRED);
    }
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
    /** A machine-readable reason, e.g. APP_UPDATE_REQUIRED. */
    readonly code?: string,
  ) {
    super(message);
  }
}
