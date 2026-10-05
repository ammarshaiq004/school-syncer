"use client";

import Link from "next/link";
import { Users } from "lucide-react";
import { buttonClass, PageHeader } from "@/components/ui";
import { RolesManager } from "@/components/settings/roles-manager";

export default function RolesPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Roles and permissions"
        description="Decide what each role can see and change, and create custom roles for jobs that do not fit the built-in ones."
        breadcrumbs={[{ label: "System settings", href: "/settings" }, { label: "Roles and permissions" }]}
        actions={
          <Link href="/staff" className={buttonClass("secondary", "md")}>
            <Users className="size-4" aria-hidden />
            Staff directory
          </Link>
        }
      />
      <RolesManager />
    </div>
  );
}
