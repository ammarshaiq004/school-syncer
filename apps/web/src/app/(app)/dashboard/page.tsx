"use client";

import { AdminDashboard } from "@/components/dashboard/admin-dashboard";
import { TeacherDashboard } from "@/components/dashboard/teacher-dashboard";
import { availableViews, resolveView, type ViewId } from "@/lib/nav";
import { usePersistedState } from "@/lib/persisted";
import { hasRole, useSession, STAFF } from "@/lib/session";

/** Home for staff: the school overview in the admin view, a teacher's day in the teacher view. */
export default function DashboardPage() {
  const user = useSession();
  const [savedView] = usePersistedState<ViewId | null>("schoolsyncer.view", null);
  // Parent-only accounts are on their way to /parent (the layout redirects); render nothing meanwhile.
  if (!hasRole(user, STAFF)) return null;
  const view = resolveView("/dashboard", savedView, availableViews(user));
  return view === "teacher" ? <TeacherDashboard /> : <AdminDashboard />;
}
