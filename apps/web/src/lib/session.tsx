"use client";

import { createContext, useContext } from "react";
import type { Role, SessionUser } from "./api";

export const SessionContext = createContext<SessionUser | null>(null);

export function useSession(): SessionUser {
  const user = useContext(SessionContext);
  if (!user) throw new Error("useSession outside the signed-in layout");
  return user;
}

export const hasRole = (user: SessionUser, roles: Role[]) =>
  user.roles.some((r) => roles.includes(r.role));

export const SETUP: Role[] = ["OWNER", "PRINCIPAL", "ADMIN"];
export const FEES: Role[] = ["OWNER", "PRINCIPAL", "ADMIN", "ACCOUNTANT"];
export const TEACHING: Role[] = [...SETUP, "TEACHER", "CLASS_TEACHER"];
export const STAFF: Role[] = [...FEES, "TEACHER", "CLASS_TEACHER", "STAFF"];
