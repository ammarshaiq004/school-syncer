import {
  Megaphone,
  Ban,
  Bug,
  Building,
  CircleCheck,
  CreditCard,
  FileText,
  History,
  KeyRound,
  LogIn,
  Receipt,
  RotateCcw,
  Smartphone,
  SlidersHorizontal,
  FlaskConical,
  PlugZap,
  Tags,
  Undo2,
  UserCog,
  UserPlus,
  Wallet,
  CircleX,
  Settings,
  type LucideIcon,
} from "lucide-react";

/** Plain-English labels for platform audit actions. */
export const AUDIT_ACTIONS: Record<string, { label: string; icon: LucideIcon }> = {
  "school.create": { label: "Created the school", icon: Building },
  "school.suspend": { label: "Suspended the school", icon: Ban },
  "school.reactivate": { label: "Reactivated the school", icon: RotateCcw },
  "school.cancel": { label: "Closed the school", icon: CircleX },
  "school.features": { label: "Changed module overrides", icon: SlidersHorizontal },
  "school.support_login": { label: "Started a support session", icon: LogIn },
  "school.user.create": { label: "Added a school user", icon: UserPlus },
  "school.user.update": { label: "Changed a school user", icon: UserCog },
  "school.user.reset_password": { label: "Reset a school user's password", icon: KeyRound },
  "subscription.update": { label: "Changed the subscription", icon: CreditCard },
  "invoice.pay": { label: "Recorded a bill payment", icon: Wallet },
  "invoice.void": { label: "Voided a bill", icon: Receipt },
  "invoices.generate": { label: "Generated monthly bills", icon: FileText },
  "payment.record": { label: "Recorded a payment", icon: Wallet },
  "payment.void": { label: "Voided a payment", icon: Undo2 },
  "message.send": { label: "Sent a message to schools", icon: Megaphone },
  "payment_claim.approve": { label: "Confirmed a payment the school reported", icon: CircleCheck },
  "payment_claim.reject": { label: "Could not confirm a payment the school reported", icon: CircleX },
  "settings.update": { label: "Changed SchoolSyncer's business settings", icon: Settings },
  "payments.gateway.check": { label: "Tested a gateway connection", icon: PlugZap },
  "payments.test.start": { label: "Started a gateway test payment", icon: FlaskConical },
  "payments.test.reverse": { label: "Reversed a gateway test payment", icon: Undo2 },
  "payments.test.cancel": { label: "Cancelled a gateway test payment", icon: CircleX },
  "plan.update": { label: "Edited a plan", icon: Tags },
  "app_version.update": { label: "Changed the mobile app versions", icon: Smartphone },
  "app_version.reset": { label: "Reset the mobile app versions to defaults", icon: Smartphone },
  "staff.create": { label: "Added a staff member", icon: UserPlus },
  "staff.update": { label: "Changed a staff member", icon: UserCog },
  "staff.reset_password": { label: "Reset a staff password", icon: KeyRound },
  "staff.change_password": { label: "Changed their own password", icon: CircleCheck },
  "problem_report.status": { label: "Changed a problem report's status", icon: Bug },
  "problem_report.assign": { label: "Gave a problem report to a staff member", icon: Bug },
  "problem_report.reply": { label: "Replied to a problem report", icon: Bug },
};

export const auditLabel = (action: string) => AUDIT_ACTIONS[action]?.label ?? action;
export const auditIcon = (action: string): LucideIcon => AUDIT_ACTIONS[action]?.icon ?? History;

/** The written reason stored with lifecycle and support actions, if any. */
export function auditReason(details: unknown): string | null {
  if (details && typeof details === "object" && "reason" in details) {
    const r = (details as { reason?: unknown }).reason;
    return typeof r === "string" ? r : null;
  }
  return null;
}
