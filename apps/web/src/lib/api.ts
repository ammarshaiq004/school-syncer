export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";

const TOKEN_KEY = "schoolsyncer.token";
/** The SchoolSyncer console signs in separately, so both can be open at once. */
const PLATFORM_TOKEN_KEY = "schoolsyncer.platform-token";

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
  plan?: SchoolPlan;
}

export type Feature =
  | "admissions"
  | "fees"
  | "online_payments"
  | "exams"
  | "homework"
  | "timetable"
  | "hr"
  | "accounts"
  | "reports"
  | "transport"
  | "library";

/** The school's SchoolSyncer plan, as /auth/me reports it. */
export interface SchoolPlan {
  name: string;
  status: "TRIAL" | "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELLED";
  trialEndsAt: string | null;
  features: Feature[];
  access: "full" | "read_only" | "blocked";
  reason: string | null;
}

function readToken(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeToken(key: string, token: string | null) {
  try {
    if (token) localStorage.setItem(key, token);
    else localStorage.removeItem(key);
  } catch {
    // Storage unavailable (private mode); the session lasts until reload.
  }
}

export const getToken = () => readToken(TOKEN_KEY);
export const setToken = (token: string | null) => writeToken(TOKEN_KEY, token);
export const setPlatformToken = (token: string | null) => writeToken(PLATFORM_TOKEN_KEY, token);

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type RequestInit = { method?: string; body?: unknown };

/** Calls the SchoolSyncer API with the school login's token and JSON body. */
export const api = <T>(path: string, init: RequestInit = {}) => request<T>(path, init, getToken());

/** Calls the console's /platform endpoints with the SchoolSyncer staff token. */
export const platformApi = <T>(path: string, init: RequestInit = {}) =>
  request<T>(`/platform${path}`, init, readToken(PLATFORM_TOKEN_KEY));

async function request<T>(path: string, init: RequestInit, token: string | null): Promise<T> {
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
