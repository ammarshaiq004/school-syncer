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
  roles: { role: Role; campusId: string | null; customRoleId?: string | null }[];
  plan?: SchoolPlan;
  /** Effective access per module (from /auth/me). Missing on old API versions: then only roles gate pages. */
  permissions?: Partial<Record<PermissionModule, AccessLevel>>;
  /** Set when SchoolSyncer staff opened this session from the console for support. */
  support?: { adminId: string; adminName: string } | null;
  /** The school, with its delivery mode (drives which modules the app shows). Missing on old API versions. */
  school?: { id: string; name: string; slug: string; mode: SchoolMode; logoUrl: string | null };
  /** The student record behind a STUDENT login, else null. */
  studentId?: string | null;
  /** Someone else issued the password: the app shows only the change-password page until it is replaced. */
  mustChangePassword?: boolean;
}

/** How the school teaches: on campus, online, or both. */
export type SchoolMode = "PHYSICAL" | "ONLINE" | "HYBRID";

/** Access levels of the school permission layer, lowest first. */
export type AccessLevel = "none" | "view" | "manage";

/** Permission module keys (same as apps/api/src/common/permissions.ts). */
export type PermissionModule =
  | "dashboard"
  | "assistant"
  | "students"
  | "admissions"
  | "attendance"
  | "promotions"
  | "certificates"
  | "timetable"
  | "homework"
  | "exams"
  | "elearning"
  | "gradebook"
  | "lesson_plans"
  | "fees"
  | "accounts"
  | "reports"
  | "billing"
  | "hr"
  | "transport"
  | "library"
  | "announcements"
  | "messages"
  | "chat"
  | "campuses"
  | "classes"
  | "users"
  | "settings"
  | "audit";

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
  | "library"
  | "certificates"
  | "elearning"
  | "ai_assistant";

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

/**
 * A support session (SchoolSyncer staff signed in as a school's owner) lives in
 * this tab's sessionStorage only, so it never replaces the normal school login
 * kept in localStorage and other tabs stay signed in as themselves.
 */
const SUPPORT_TOKEN_KEY = "schoolsyncer.support-token";
const SUPPORT_INFO_KEY = "schoolsyncer.support-info";

export interface SupportInfo {
  schoolName: string | null;
  expiresAt: string | null;
}

export function getSupportToken(): string | null {
  try {
    return sessionStorage.getItem(SUPPORT_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getSupportInfo(): SupportInfo {
  try {
    const raw = sessionStorage.getItem(SUPPORT_INFO_KEY);
    if (raw) return { schoolName: null, expiresAt: null, ...(JSON.parse(raw) as Partial<SupportInfo>) };
  } catch {
    // Missing or unreadable: show the banner without these details.
  }
  return { schoolName: null, expiresAt: null };
}

export function startSupportSession(token: string, info: SupportInfo) {
  try {
    sessionStorage.setItem(SUPPORT_TOKEN_KEY, token);
    sessionStorage.setItem(SUPPORT_INFO_KEY, JSON.stringify(info));
  } catch {
    // sessionStorage blocked: the support page reports it.
  }
}

export function endSupportSession() {
  try {
    sessionStorage.removeItem(SUPPORT_TOKEN_KEY);
    sessionStorage.removeItem(SUPPORT_INFO_KEY);
  } catch {
    // Nothing stored.
  }
}

/** The school token for this tab: a support session first, else the normal login. */
export const getToken = () => getSupportToken() ?? readToken(TOKEN_KEY);
/** Signing out or in from a support tab ends the support session and leaves the normal login alone. */
export const setToken = (token: string | null) => {
  if (getSupportToken()) {
    endSupportSession();
    if (!token) return;
  }
  writeToken(TOKEN_KEY, token);
};
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
export const api = <T>(path: string, init: RequestInit = {}) => request<T>(path, init, getToken(), "school");

/** Calls the console's /platform endpoints with the SchoolSyncer staff token. */
export const platformApi = <T>(path: string, init: RequestInit = {}) =>
  request<T>(`/platform${path}`, init, readToken(PLATFORM_TOKEN_KEY), "platform");

/**
 * The token was refused (expired, signed out elsewhere, or ended by a password
 * change or reset): forget it and go to the matching sign-in page.
 */
function sessionEnded(kind: "school" | "platform") {
  if (typeof window === "undefined") return;
  let target: string;
  if (kind === "platform") {
    writeToken(PLATFORM_TOKEN_KEY, null);
    target = "/platform/login";
  } else if (getSupportToken()) {
    // A support session ends in this tab only; the normal login stays.
    endSupportSession();
    target = "/support/ended";
  } else {
    writeToken(TOKEN_KEY, null);
    target = "/login";
  }
  if (window.location.pathname !== target) window.location.replace(target);
}

async function request<T>(path: string, init: RequestInit, token: string | null, kind: "school" | "platform"): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = await res.json().catch(() => null);
  // A wrong password on a sign-in form is also a 401; only a refused token ends the session.
  if (res.status === 401 && token && !path.endsWith("/auth/login")) sessionEnded(kind);
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
