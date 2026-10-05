"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ArrowRight, Building, History, Library, ShieldCheck, Users, Wallet } from "lucide-react";
import { Alert, buttonClass, Card, CardHeader, ErrorState, PageHeader, SkeletonRows, TabPanel, Tabs } from "@/components/ui";
import { AuditLog } from "@/components/settings/audit-log";
import { RolesManager } from "@/components/settings/roles-manager";
import { FeeSettingsForm, SchoolProfileForm, type School } from "@/components/settings/school-settings";
import { can, hasRole, SETUP, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

type Tab = "profile" | "fees" | "library" | "roles" | "audit";

export default function SettingsPage() {
  return (
    <Suspense>
      <Settings />
    </Suspense>
  );
}

function Settings() {
  const user = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const school = useApi<School>("/school");
  const [saved, setSaved] = useState<School | null>(null);
  const data = saved ?? school.data;

  const setup = hasRole(user, SETUP);
  const canEditSettings = setup && can(user, "settings", "manage");
  const tabs = [
    { value: "profile", label: "School profile", icon: <Building /> },
    { value: "fees", label: "Fees", icon: <Wallet /> },
    { value: "library", label: "Library", icon: <Library /> },
    ...(setup && can(user, "users") ? [{ value: "roles", label: "Roles and permissions", icon: <ShieldCheck /> }] : []),
    ...(setup && can(user, "audit") ? [{ value: "audit", label: "Audit log", icon: <History /> }] : []),
  ];
  const requested = params.get("tab") as Tab | null;
  const tab: Tab = requested && tabs.some((t) => t.value === requested) ? requested : "profile";

  function changeTab(next: string) {
    const q = new URLSearchParams(params.toString());
    if (next === "profile") q.delete("tab");
    else q.set("tab", next);
    const qs = q.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const schoolSection = (render: (s: School) => React.ReactNode) =>
    school.error && !data ? (
      <ErrorState message={school.error} onRetry={school.reload} />
    ) : !data ? (
      <Card>
        <SkeletonRows rows={4} columns={2} />
      </Card>
    ) : (
      render(data)
    );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="System settings"
        description="Your school's details, fee rules, who can do what, and a record of every change."
        breadcrumbs={[{ label: "Setup" }, { label: "System settings" }]}
      />
      {!canEditSettings && <Alert tone="info">Your role can view these settings but not change them.</Alert>}
      <Tabs tabs={tabs} value={tab} onValueChange={changeTab} aria-label="Settings sections">
        <TabPanel value="profile">
          <div className="max-w-3xl">{schoolSection((s) => <SchoolProfileForm key={s.id} school={s} readOnly={!canEditSettings} onSaved={setSaved} />)}</div>
        </TabPanel>
        <TabPanel value="fees">
          <div className="max-w-3xl">{schoolSection((s) => <FeeSettingsForm key={s.id} school={s} readOnly={!canEditSettings} onSaved={setSaved} />)}</div>
        </TabPanel>
        <TabPanel value="library">
          <Card className="max-w-3xl">
            <CardHeader
              icon={<Library />}
              title="Library rules"
              description="Loan period, fine per day and how many books each borrower can take are set on the Library page."
            />
            <Link href="/library" className={buttonClass("secondary", "md")}>
              Open library rules
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Card>
        </TabPanel>
        {tabs.some((t) => t.value === "roles") && (
          <TabPanel value="roles">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-[13px] text-fg-muted">Changes apply the next time each person loads a page.</p>
              <Link href="/staff" className={buttonClass("ghost", "sm")}>
                <Users className="size-4" aria-hidden />
                Assign roles in the staff directory
              </Link>
            </div>
            {tab === "roles" && <RolesManager />}
          </TabPanel>
        )}
        {tabs.some((t) => t.value === "audit") && <TabPanel value="audit">{tab === "audit" && <AuditLog />}</TabPanel>}
      </Tabs>
    </div>
  );
}
