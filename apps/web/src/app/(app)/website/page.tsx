"use client";

import { Card, ErrorState, PageHeader, SkeletonRows } from "@/components/ui";
import { WebsiteEditor, type CampusFacts, type SchoolFacts } from "@/components/website/website-editor";
import { can, hasRole, SETUP, useSession } from "@/lib/session";
import type { SiteEditorData } from "@/lib/site";
import { useApi } from "@/lib/use-api";

export default function WebsitePage() {
  const user = useSession();
  const site = useApi<SiteEditorData>("/school/site");
  const school = useApi<SchoolFacts>("/school");
  const campuses = useApi<CampusFacts[]>("/campuses");

  const plan = user.plan;
  const canEdit = hasRole(user, SETUP) && can(user, "settings", "manage");
  const { data: siteData } = site;
  const { data: schoolData } = school;
  const { data: campusData } = campuses;
  const lockedReason = !canEdit
    ? "Your role can view the website settings but not change them."
    : plan?.access === "read_only"
      ? "Your subscription is read-only, so changes cannot be saved right now."
      : null;
  const failed = site.error || school.error || campuses.error;
  const admissionsOpen = !!plan && plan.access !== "read_only" && plan.features.includes("admissions");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="School website"
        description="A public website for your school at its own address, built from your details and drawn in your colours."
        breadcrumbs={[{ label: "Setup" }, { label: "School website" }]}
      />
      {!(siteData && schoolData && campusData) ? (
        failed ? (
          <ErrorState message={failed} onRetry={() => { site.reload(); school.reload(); campuses.reload(); }} />
        ) : (
          <Card><SkeletonRows rows={5} columns={2} /></Card>
        )
      ) : (
        <>
          <WebsiteEditor
            key={siteData.slug}
            data={siteData}
            school={schoolData}
            campuses={campusData}
            admissionsOpen={admissionsOpen}
            lockedReason={lockedReason}
            onSaved={site.reload}
          />
        </>
      )}
    </div>
  );
}
