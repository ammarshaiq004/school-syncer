import {
  Award,
  BookOpen,
  BriefcaseBusiness,
  Building,
  Bus,
  CalendarCheck,
  CalendarClock,
  ChartColumn,
  ClipboardCheck,
  CreditCard,
  GraduationCap,
  HeartHandshake,
  Landmark,
  Layers,
  LayoutDashboard,
  Library,
  Megaphone,
  MessagesSquare,
  NotebookPen,
  Presentation,
  ShieldCheck,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { Feature, Role, SessionUser } from "./api";
import { FEES, hasRole, SETUP, STAFF, TEACHING } from "./session";

/**
 * Sidebar and command-palette navigation, per role view.
 * To add a page: add one item to the right group below with the views it belongs to.
 * Only add items whose page exists.
 */

export type ViewId = "admin" | "teacher" | "student" | "parent";
/** School delivery mode (added by PR 3); items with `modes` only show for those modes. */
export type SchoolMode = "PHYSICAL" | "ONLINE" | "HYBRID";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Any of these roles can see it. */
  roles: Role[];
  /** Hidden when the school's plan lacks this feature. */
  feature?: Feature;
  /** Only for these school modes (ignored when the mode is unknown). */
  modes?: SchoolMode[];
  /** Views whose sidebar shows this item. */
  views: ViewId[];
  /** Extra words for the command palette search. */
  keywords?: string;
  /** Override the label in a particular view (e.g. "Marks" in the teacher view). */
  viewLabels?: Partial<Record<ViewId, string>>;
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

export interface ViewDef {
  id: ViewId;
  label: string;
  short: string;
  description: string;
  home: string;
  icon: LucideIcon;
  /** Roles that unlock this view. */
  roles: Role[];
}

const ADMIN_ROLES: Role[] = [...FEES, "STAFF"];
const TEACHER_ROLES: Role[] = [...SETUP, "TEACHER", "CLASS_TEACHER"];

export const VIEWS: ViewDef[] = [
  { id: "admin", label: "Admin & Registrar", short: "Admin", description: "Run the whole school", home: "/dashboard", icon: LayoutDashboard, roles: ADMIN_ROLES },
  { id: "teacher", label: "Teacher Portal", short: "Teacher", description: "Classes, attendance and marks", home: "/dashboard", icon: Presentation, roles: TEACHER_ROLES },
  { id: "student", label: "Student Workspace", short: "Student", description: "Lessons, homework and results", home: "/student", icon: GraduationCap, roles: ["STUDENT"] },
  { id: "parent", label: "Parent Dashboard", short: "Parent", description: "Your children at a glance", home: "/parent", icon: HeartHandshake, roles: ["PARENT"] },
];

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "overview",
    label: "Overview",
    items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: STAFF, views: ["admin", "teacher"], keywords: "home summary" }],
  },
  {
    id: "people",
    label: "People",
    items: [
      { href: "/students", label: "Students", icon: GraduationCap, roles: STAFF, views: ["admin", "teacher"], keywords: "pupils directory profile" },
      { href: "/admissions", label: "Admissions", icon: UserPlus, roles: SETUP, feature: "admissions", views: ["admin"], keywords: "enquiries applications" },
      { href: "/users", label: "Users and roles", icon: ShieldCheck, roles: SETUP, views: ["admin"], keywords: "staff logins permissions invite" },
      { href: "/hr", label: "HR and payroll", icon: BriefcaseBusiness, roles: STAFF, feature: "hr", views: ["admin", "teacher"], keywords: "staff salary payslips leave my leave", viewLabels: { teacher: "My leave and payslips" } },
    ],
  },
  {
    id: "academics",
    label: "Academics",
    items: [
      { href: "/classes", label: "Classes and sections", icon: Layers, roles: SETUP, views: ["admin"], keywords: "grades subjects" },
      { href: "/attendance", label: "Attendance", icon: CalendarCheck, roles: TEACHING, views: ["admin", "teacher"], keywords: "present absent register" },
      { href: "/timetable", label: "Timetable", icon: CalendarClock, roles: STAFF, feature: "timetable", views: ["admin", "teacher"], keywords: "periods schedule" },
      { href: "/homework", label: "Homework", icon: NotebookPen, roles: TEACHING, feature: "homework", views: ["admin", "teacher"], keywords: "assignments diary" },
      { href: "/exams", label: "Exams and results", icon: ClipboardCheck, roles: TEACHING, feature: "exams", views: ["admin", "teacher"], keywords: "marks report cards grades", viewLabels: { teacher: "Exams and marks" } },
      { href: "/promotions", label: "Promotions", icon: TrendingUp, roles: SETUP, views: ["admin"], keywords: "year end next year" },
      { href: "/certificates", label: "Certificates and ID cards", icon: Award, roles: STAFF, feature: "certificates", views: ["admin", "teacher"], keywords: "leaving character id card" },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    items: [
      { href: "/fees", label: "Fees", icon: Wallet, roles: FEES, feature: "fees", views: ["admin"], keywords: "invoices vouchers defaulters" },
      { href: "/accounts", label: "Accounts", icon: Landmark, roles: FEES, feature: "accounts", views: ["admin"], keywords: "cashbook expenses income" },
      { href: "/reports", label: "Reports", icon: ChartColumn, roles: FEES, feature: "reports", views: ["admin"], keywords: "analytics collection" },
      { href: "/billing", label: "Plan and billing", icon: CreditCard, roles: FEES, views: ["admin"], keywords: "subscription plan" },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    items: [
      { href: "/transport", label: "Transport", icon: Bus, roles: STAFF, feature: "transport", views: ["admin", "teacher"], keywords: "routes vans buses" },
      { href: "/library", label: "Library", icon: Library, roles: STAFF, feature: "library", views: ["admin", "teacher"], keywords: "books loans" },
    ],
  },
  {
    id: "communication",
    label: "Communication",
    items: [
      { href: "/announcements", label: "Announcements", icon: Megaphone, roles: STAFF, views: ["admin", "teacher"], keywords: "notices news" },
      { href: "/messages", label: "Message log", icon: MessagesSquare, roles: SETUP, views: ["admin"], keywords: "whatsapp sms notifications" },
    ],
  },
  {
    id: "setup",
    label: "Setup",
    items: [{ href: "/campuses", label: "Campuses", icon: Building, roles: SETUP, views: ["admin"], keywords: "branches" }],
  },
  {
    // PR 3 adds the student pages here.
    id: "learning",
    label: "Learning",
    items: [],
  },
  {
    id: "family",
    label: "My family",
    items: [{ href: "/parent", label: "My children", icon: Users, roles: ["PARENT"], views: ["parent"], keywords: "kids results fees timetable" }],
  },
];

/** Placeholder icon for empty student groups (used by the shell). */
export const STUDENT_PLACEHOLDER_ICON = BookOpen;

export const viewDef = (id: ViewId) => VIEWS.find((v) => v.id === id)!;

/** Views this account can use, in VIEWS order. */
export function availableViews(user: SessionUser): ViewId[] {
  return VIEWS.filter((v) => hasRole(user, v.roles)).map((v) => v.id);
}

/** A view implied by the URL (student and parent areas), else null. */
export function viewFromPath(pathname: string): ViewId | null {
  if (pathname === "/student" || pathname.startsWith("/student/")) return "student";
  if (pathname === "/parent" || pathname.startsWith("/parent/")) return "parent";
  return null;
}

/**
 * The active view: the one the URL implies (/student, /parent), else the saved choice when it applies here,
 * else the account's first view. Staff pages (anything outside /student and /parent) only use the
 * admin or teacher view, so a saved "parent" view does not leak onto /dashboard.
 */
export function resolveView(pathname: string, saved: ViewId | null, available: ViewId[]): ViewId {
  const fromPath = viewFromPath(pathname);
  if (fromPath) return fromPath;
  const staffViews: ViewId[] = available.filter((v) => v === "admin" || v === "teacher");
  if (saved && staffViews.includes(saved)) return saved;
  return staffViews[0] ?? available[0] ?? "admin";
}

interface NavContext {
  user: SessionUser;
  view: ViewId;
  mode?: SchoolMode | null;
}

function visible(item: NavItem, { user, view, mode }: NavContext) {
  const features = user.plan?.features;
  return (
    item.views.includes(view) &&
    hasRole(user, item.roles) &&
    (!item.feature || !features || features.includes(item.feature)) &&
    (!item.modes || !mode || item.modes.includes(mode))
  );
}

/** Sidebar groups for a view, filtered by role, plan feature and school mode. Empty groups are dropped. */
export function navForView(ctx: NavContext): NavGroup[] {
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => visible(i, ctx)).map((i) => ({ ...i, label: i.viewLabels?.[ctx.view] ?? i.label })),
  })).filter((g) => g.items.length > 0);
}

/** Every item the user can reach in any of their views (for the command palette), de-duplicated by href. */
export function allNavItems(user: SessionUser, mode?: SchoolMode | null): (NavItem & { group: string })[] {
  const seen = new Set<string>();
  const out: (NavItem & { group: string })[] = [];
  for (const view of availableViews(user)) {
    for (const g of NAV_GROUPS) {
      for (const i of g.items) {
        if (seen.has(i.href) || !visible(i, { user, view, mode })) continue;
        seen.add(i.href);
        out.push({ ...i, group: g.label });
      }
    }
  }
  return out;
}

/** The most specific href matching the path (so /fees/invoices/1 highlights /fees). */
export function activeHref(pathname: string, hrefs: string[]): string | undefined {
  let best: string | undefined;
  for (const h of hrefs) {
    if (pathname === h || pathname.startsWith(h + "/")) {
      if (!best || h.length > best.length) best = h;
    }
  }
  return best;
}
