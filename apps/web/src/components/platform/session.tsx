"use client";

import { createContext, useContext } from "react";

export type PlatformRole = "OWNER" | "SUPPORT";

/** The signed-in SchoolSyncer staff member, as /platform/auth/me returns it. */
export interface ConsoleAdmin {
  sub: string;
  name: string;
  email: string;
  role: PlatformRole;
  mustChangePassword: boolean;
}

export const ConsoleAdminContext = createContext<ConsoleAdmin | null>(null);

/** The console's signed-in staff member. Only use inside the console layout. */
export function useConsoleAdmin(): ConsoleAdmin {
  const admin = useContext(ConsoleAdminContext);
  if (!admin) throw new Error("useConsoleAdmin is only available inside the console");
  return admin;
}

export const isOwner = (admin: ConsoleAdmin | null) => admin?.role === "OWNER";

export const PLATFORM_ROLE_LABEL: Record<PlatformRole, string> = { OWNER: "Owner", SUPPORT: "Support" };

/** "5 Oct 2026, 14:20", in Pakistan time like the school audit log. */
export const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Karachi" });
