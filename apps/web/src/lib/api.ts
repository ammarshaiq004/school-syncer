export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";

const TOKEN_KEY = "schoolsyncer.token";

export type Role =
  | "OWNER"
  | "PRINCIPAL"
  | "ADMIN"
  | "ACCOUNTANT"
  | "TEACHER"
  | "CLASS_TEACHER"
  | "PARENT"
  | "STUDENT"
  | "STAFF";

export interface SessionUser {
  sub: string;
  schoolId: string;
  name: string;
  roles: { role: Role; campusId: string | null }[];
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage unavailable (private mode); the session lasts until reload.
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Calls the SchoolSyncer API with the stored token and JSON body. */
export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const issues: { path: string; message: string }[] | undefined =
      data?.issues;
    const message = issues?.length
      ? issues.map((i) => `${i.path}: ${i.message}`).join(", ")
      : (data?.message ?? `Request failed (${res.status})`);
    throw new ApiError(res.status, message);
  }
  return data as T;
}
