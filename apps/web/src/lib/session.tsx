"use client";

import { createContext, useCallback, useContext } from "react";
import type { AccessLevel, PermissionModule, Role, SchoolMode, SessionUser } from "./api";

export const SessionContext = createContext<SessionUser | null>(null);

export function useSession(): SessionUser {
  const user = useContext(SessionContext);
  if (!user) throw new Error("useSession outside the signed-in layout");
  return user;
}

export const hasRole = (user: SessionUser, roles: Role[]) =>
  user.roles.some((r) => roles.includes(r.role));

const LEVEL_RANK: Record<AccessLevel, number> = { none: 0, view: 1, manage: 2 };

/**
 * True when the user's roles give at least `level` on `module` (default view).
 * Owners always can. When the API sent no permissions (older session), the role checks alone decide.
 */
export function can(user: SessionUser, module: PermissionModule, level: Exclude<AccessLevel, "none"> = "view"): boolean {
  if (user.roles.some((r) => r.role === "OWNER")) return true;
  const perms = user.permissions;
  if (!perms) return true;
  return LEVEL_RANK[perms[module] ?? "none"] >= LEVEL_RANK[level];
}

/** `can(module, level)` bound to the signed-in user, for hiding buttons. */
export function useCan() {
  const user = useSession();
  return useCallback((module: PermissionModule, level: Exclude<AccessLevel, "none"> = "view") => can(user, module, level), [user]);
}

export const SETUP: Role[] = ["OWNER", "PRINCIPAL", "ADMIN"];
export const FEES: Role[] = ["OWNER", "PRINCIPAL", "ADMIN", "ACCOUNTANT"];
export const TEACHING: Role[] = [...SETUP, "TEACHER", "CLASS_TEACHER"];
export const STAFF: Role[] = [...FEES, "TEACHER", "CLASS_TEACHER", "STAFF"];

/** The school's delivery mode (PHYSICAL, ONLINE or HYBRID), or null on an older API. */
export function useSchoolMode(): SchoolMode | null {
  return useSession().school?.mode ?? null;
}
