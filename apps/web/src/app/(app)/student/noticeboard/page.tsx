"use client";

import { useMemo, useState } from "react";
import { Megaphone } from "lucide-react";
import { AUDIENCE_LABEL } from "@/components/student/format";
import { NoticeList } from "@/components/student/notice-list";
import type { Notice } from "@/components/student/types";
import { Card, EmptyState, ErrorState, PageHeader, SearchInput, SegmentedControl, SkeletonRows } from "@/components/ui";
import { useApi } from "@/lib/use-api";

type Filter = "all" | "school" | "class";

export default function StudentNoticeboardPage() {
  const notices = useApi<Notice[]>("/student/announcements?limit=100");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (notices.data ?? []).filter(
      (n) =>
        (filter === "all" ||
          (filter === "school" ? n.audience === "SCHOOL" || n.audience === "CAMPUS" : n.audience === "CLASS" || n.audience === "SECTION")) &&
        (!q || `${n.title} ${n.body} ${n.createdBy ?? ""} ${AUDIENCE_LABEL[n.audience]}`.toLowerCase().includes(q)),
    );
  }, [notices.data, query, filter]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Noticeboard"
        description="Announcements for the whole school, your campus, your class and your section."
        breadcrumbs={[{ label: "Learning" }, { label: "Noticeboard" }]}
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput value={query} onChange={(e) => setQuery(e.target.value)} onClear={() => setQuery("")} placeholder="Search notices" wrapperClassName="sm:w-72" />
        <SegmentedControl<Filter>
          aria-label="Show notices for"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "school", label: "School" },
            { value: "class", label: "My class" },
          ]}
        />
      </div>
      <Card>
        {notices.error && !notices.data ? (
          <ErrorState message={notices.error} onRetry={notices.reload} compact />
        ) : !notices.data ? (
          <SkeletonRows rows={5} columns={1} />
        ) : notices.data.length === 0 ? (
          <EmptyState icon={<Megaphone />} title="No notices yet" description="When the school posts an announcement for you, it shows here." compact />
        ) : shown.length === 0 ? (
          <EmptyState icon={<Megaphone />} title="No notices match" description="Try another search or show all notices." compact />
        ) : (
          <NoticeList notices={shown} full />
        )}
      </Card>
    </div>
  );
}
