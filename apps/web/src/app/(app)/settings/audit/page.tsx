"use client";

import { PageHeader } from "@/components/ui";
import { AuditLog } from "@/components/settings/audit-log";

export default function AuditPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Audit log"
        description="Who changed what and when: staff logins, roles, permissions and school settings. Open a row to see the before and after values."
        breadcrumbs={[{ label: "System settings", href: "/settings" }, { label: "Audit log" }]}
      />
      <AuditLog />
    </div>
  );
}
