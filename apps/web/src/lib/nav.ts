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
  Contact,
  CreditCard,
  FileCheck,
  GraduationCap,
  HeartHandshake,
  History,
  Landmark,
  Layers,
  LayoutDashboard,
  Library,
  ListChecks,
  Megaphone,
  MessageCircle,
  MessagesSquare,
  MonitorPlay,
  NotebookPen,
  NotebookText,
  Presentation,
  ReceiptText,
  Settings,
  ShieldCheck,
  Sun,
  Table2,
  TrendingUp,
  UserPlus,
  Users,
  Video,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { Feature, PermissionModule, Role, SchoolMode, SessionUser } from "./api";
import { can, FEES, hasRole, SETUP, STAFF, TEACHING } from "./session";

/**
 * Sidebar and command-palette navigation, per role view.
 * To add a page: add one item to the right group below with the views it belongs to.
 * Only add items whose page exists.
 */

export type ViewId = "admin" | "teacher" | "student" | "parent";
/** School delivery mode; items with `modes` only show for those modes. */
export type { SchoolMode };
/** Modules that only make sense on a campus (hidden for online-only schools). */
const ON_CAMPUS: SchoolMode[] = ["PHYSICAL", "HYBRID"];
/** E-school modules (online and hybrid schools). */
const E_SCHOOL: SchoolMode[] = ["ONLINE", "HYBRID"];

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Any of these roles can see it. */
  roles: Role[];
  /** Hidden when the school's plan lacks this feature. */
  feature?: Feature;
  /** Hidden when the school's plan has none of these features. */
  anyFeature?: Feature[];
  /** Permission module behind the page; hidden when the user's access to it is "none". */
  module?: PermissionModule;
  /** Only for these school modes (ignored when the mode is unknown). */
  modes?: SchoolMode[];
  /** Views whose sidebar shows this item. */
  views: ViewId[];
  /** Extra words for the command palette search. */
  keywords?: string;
  /** Override the label in a particular view (e.g. "Marks" in the teacher view). */
  viewLabels?: Partial<Record<ViewId, string>>;
  /** Override the label for a school mode (e.g. no "ID cards" for online schools). */
  modeLabels?: Partial<Record<SchoolMode, string>>;
  /** Live count shown as a badge next to the label (the shell fetches it). */
  count?: NavCount;
}

/** Counts the sidebar can show on an item. */
export type NavCount = "chatUnread";

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
    items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, module: "dashboard", roles: STAFF, views: ["admin", "teacher"], keywords: "home summary" }],
  },
  {
    id: "people",
    label: "People",
    items: [
      { href: "/students", label: "Students", icon: GraduationCap, module: "students", roles: STAFF, views: ["admin", "teacher"], keywords: "pupils directory profile student directory", viewLabels: { admin: "Student directory" } },
      { href: "/admissions", label: "Admissions", icon: UserPlus, module: "admissions", roles: SETUP, feature: "admissions", views: ["admin"], keywords: "enquiries applications" },
      { href: "/hr", label: "HR and payroll", icon: BriefcaseBusiness, module: "hr", roles: STAFF, feature: "hr", views: ["admin", "teacher"], keywords: "staff salary payslips leave my leave", viewLabels: { teacher: "My leave and payslips" } },
    ],
  },
  {
    id: "academics",
    label: "Academics",
    items: [
      { href: "/classes", label: "Classes and sections", icon: Layers, module: "classes", roles: SETUP, views: ["admin"], keywords: "grades subjects" },
      { href: "/attendance", label: "Attendance", icon: CalendarCheck, module: "attendance", roles: TEACHING, views: ["admin", "teacher"], keywords: "present absent register monthly matrix class timetable", viewLabels: { teacher: "Classes and attendance" } },
      { href: "/timetable", label: "Timetable", icon: CalendarClock, module: "timetable", roles: STAFF, feature: "timetable", views: ["admin", "teacher"], keywords: "periods schedule" },
      { href: "/homework", label: "Homework", icon: NotebookPen, module: "homework", roles: TEACHING, feature: "homework", views: ["admin", "teacher"], keywords: "assignments diary" },
      { href: "/exams", label: "Exams and results", icon: ClipboardCheck, module: "exams", roles: TEACHING, feature: "exams", views: ["admin", "teacher"], keywords: "marks report cards grades", viewLabels: { teacher: "Exams and marks" } },
      { href: "/gradebook", label: "Gradebook", icon: Table2, module: "gradebook", roles: TEACHING, anyFeature: ["exams", "elearning"], views: ["admin", "teacher"], keywords: "marks scores grades assessment matrix spreadsheet letter grade" },
      { href: "/lesson-plans", label: "Lesson plans", icon: NotebookText, module: "lesson_plans", roles: TEACHING, views: ["admin", "teacher"], keywords: "weekly plan scheme of work review approve" },
      { href: "/promotions", label: "Promotions", icon: TrendingUp, module: "promotions", roles: SETUP, views: ["admin"], keywords: "year end next year" },
      { href: "/certificates", label: "Certificates and ID cards", icon: Award, module: "certificates", roles: STAFF, feature: "certificates", views: ["admin", "teacher"], keywords: "leaving character id card", modeLabels: { ONLINE: "Certificates" } },
    ],
  },
  {
    id: "eschool",
    label: "E-school",
    items: [
      { href: "/elearning", label: "E-school overview", icon: MonitorPlay, module: "elearning", roles: STAFF, feature: "elearning", modes: E_SCHOOL, views: ["admin", "teacher"], keywords: "online learning elearning today grading" },
      { href: "/elearning/courses", label: "Courses", icon: BookOpen, module: "elearning", roles: STAFF, feature: "elearning", modes: E_SCHOOL, views: ["admin", "teacher"], keywords: "units lessons videos course builder" },
      { href: "/elearning/live", label: "Live classes", icon: Video, module: "elearning", roles: STAFF, feature: "elearning", modes: E_SCHOOL, views: ["admin", "teacher"], keywords: "online class jitsi zoom meet schedule" },
      { href: "/elearning/assignments", label: "Assignments", icon: FileCheck, module: "elearning", roles: STAFF, feature: "elearning", modes: E_SCHOOL, views: ["admin", "teacher"], keywords: "submissions grading marking coursework" },
      { href: "/elearning/quizzes", label: "Quizzes", icon: ListChecks, module: "elearning", roles: STAFF, feature: "elearning", modes: E_SCHOOL, views: ["admin", "teacher"], keywords: "online test mcq auto marking results" },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    items: [
      { href: "/fees", label: "Fees", icon: Wallet, module: "fees", roles: FEES, feature: "fees", views: ["admin"], keywords: "invoices vouchers defaulters fee management", viewLabels: { admin: "Fee management" } },
      { href: "/accounts", label: "Accounts", icon: Landmark, module: "accounts", roles: FEES, feature: "accounts", views: ["admin"], keywords: "cashbook expenses income" },
      { href: "/reports", label: "Reports", icon: ChartColumn, module: "reports", roles: FEES, feature: "reports", views: ["admin"], keywords: "analytics collection" },
      { href: "/billing", label: "Plan and billing", icon: CreditCard, module: "billing", roles: FEES, views: ["admin"], keywords: "subscription plan" },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    items: [
      { href: "/transport", label: "Transport", icon: Bus, module: "transport", roles: STAFF, feature: "transport", modes: ON_CAMPUS, views: ["admin", "teacher"], keywords: "routes vans buses" },
      { href: "/library", label: "Library", icon: Library, module: "library", roles: STAFF, feature: "library", modes: ON_CAMPUS, views: ["admin", "teacher"], keywords: "books loans" },
    ],
  },
  {
    id: "communication",
    label: "Communication",
    items: [
      { href: "/announcements", label: "Announcements", icon: Megaphone, module: "announcements", roles: STAFF, views: ["admin", "teacher"], keywords: "notices news" },
      { href: "/chat", label: "Messages", icon: MessageCircle, module: "chat", roles: TEACHING, views: ["admin", "teacher"], keywords: "chat parents parent teacher conversations inbox safeguarding", viewLabels: { admin: "Parent-teacher chat" }, count: "chatUnread" },
      { href: "/messages", label: "Message log", icon: MessagesSquare, module: "messages", roles: SETUP, views: ["admin"], keywords: "whatsapp sms notifications" },
    ],
  },
  {
    id: "setup",
    label: "Setup",
    items: [
      { href: "/staff", label: "Staff directory", icon: Contact, module: "users", roles: SETUP, views: ["admin"], keywords: "users teachers logins invite deactivate reset password" },
      { href: "/settings/roles", label: "Roles and permissions", icon: ShieldCheck, module: "users", roles: SETUP, views: ["admin"], keywords: "access custom roles matrix" },
      { href: "/campuses", label: "Campuses", icon: Building, module: "campuses", roles: SETUP, views: ["admin"], keywords: "branches" },
      { href: "/settings", label: "System settings", icon: Settings, module: "settings", roles: SETUP, views: ["admin"], keywords: "school profile logo fee due day late fee" },
      { href: "/settings/audit", label: "Audit log", icon: History, module: "audit", roles: SETUP, views: ["admin"], keywords: "activity history changes who changed" },
    ],
  },
  {
    // Student workspace.
    id: "learning",
    label: "Learning",
    items: [
      { href: "/student", label: "Today's schedule", icon: Sun, module: "dashboard", roles: ["STUDENT"], views: ["student"], keywords: "today home timetable periods due" },
      { href: "/student/timetable", label: "Timetable", icon: CalendarClock, module: "timetable", roles: ["STUDENT"], feature: "timetable", views: ["student"], keywords: "week periods schedule tomorrow classes" },
      { href: "/student/courses", label: "Courses", icon: BookOpen, module: "elearning", roles: ["STUDENT"], feature: "elearning", modes: E_SCHOOL, views: ["student"], keywords: "lessons videos units" },
      { href: "/student/live", label: "Live classes", icon: Video, module: "elearning", roles: ["STUDENT"], feature: "elearning", modes: E_SCHOOL, views: ["student"], keywords: "online class join meeting" },
      { href: "/student/assignments", label: "Assignments", icon: NotebookPen, module: "elearning", roles: ["STUDENT"], feature: "elearning", modes: E_SCHOOL, views: ["student"], keywords: "homework submit work" },
      { href: "/student/quizzes", label: "Quizzes", icon: ListChecks, module: "elearning", roles: ["STUDENT"], feature: "elearning", modes: E_SCHOOL, views: ["student"], keywords: "test mcq" },
      { href: "/student/grades", label: "Grades and transcripts", icon: ClipboardCheck, module: "exams", roles: ["STUDENT"], views: ["student"], keywords: "results report card marks scores" },
      { href: "/student/library", label: "Library", icon: Library, module: "library", roles: ["STUDENT"], feature: "library", modes: ON_CAMPUS, views: ["student"], keywords: "books loans" },
      { href: "/student/noticeboard", label: "Noticeboard", icon: Megaphone, module: "announcements", roles: ["STUDENT"], views: ["student"], keywords: "notices announcements news" },
      { href: "/student/attendance", label: "Attendance", icon: CalendarCheck, module: "attendance", roles: ["STUDENT"], views: ["student"], keywords: "present absent days" },
    ],
  },
  {
    id: "family",
    label: "My family",
    items: [
      { href: "/parent", label: "Child overview", icon: Users, roles: ["PARENT"], views: ["parent"], keywords: "my children kids results fees timetable" },
      { href: "/parent/invoices", label: "Fee invoices and payment", icon: ReceiptText, module: "fees", roles: ["PARENT"], feature: "fees", views: ["parent"], keywords: "vouchers dues pay fees pdf jazzcash easypaisa bank" },
      { href: "/parent/attendance", label: "Attendance history", icon: CalendarCheck, module: "attendance", roles: ["PARENT"], views: ["parent"], keywords: "present absent late leave days heatmap" },
      { href: "/parent/chat", label: "Teacher chat", icon: MessageCircle, module: "chat", roles: ["PARENT"], views: ["parent"], keywords: "messages chat class teacher conversation inbox", count: "chatUnread" },
    ],
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
    (!item.module || can(user, item.module)) &&
    (!item.feature || !features || features.includes(item.feature)) &&
    (!item.anyFeature || !features || item.anyFeature.some((f) => features.includes(f))) &&
    (!item.modes || !mode || item.modes.includes(mode))
  );
}

/** Sidebar groups for a view, filtered by role, plan feature and school mode. Empty groups are dropped. */
export function navForView(ctx: NavContext): NavGroup[] {
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => visible(i, ctx)).map((i) => ({ ...i, label: i.viewLabels?.[ctx.view] ?? (ctx.mode ? i.modeLabels?.[ctx.mode] : undefined) ?? i.label })),
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
        out.push({ ...i, label: (mode ? i.modeLabels?.[mode] : undefined) ?? i.label, group: g.label });
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

/**
 * The nav item that owns a path (most specific href, in any view), when the user's role or custom
 * permissions give it no access. Pages hidden from the nav still open by URL, so the shell uses this
 * to show a "no access" state instead of a page full of 403s.
 */
export function blockedNavItem(user: SessionUser, pathname: string): NavItem | undefined {
  const items = NAV_GROUPS.flatMap((g) => g.items);
  const href = activeHref(
    pathname,
    items.map((i) => i.href),
  );
  if (!href) return undefined;
  const owners = items.filter((i) => i.href === href);
  // Any item for this href that the user may see makes the page reachable.
  if (owners.some((i) => !i.module || can(user, i.module))) return undefined;
  return owners[0];
}
