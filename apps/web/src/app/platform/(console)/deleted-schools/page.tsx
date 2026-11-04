"use client";

import { Download } from "lucide-react";
import { Button, DataTable, PageHeader, useToast, type Column } from "@/components/ui";
import { downloadPlatformFile } from "@/lib/download";
import { day } from "@/lib/format";
import { usePlatformApi } from "@/lib/use-api";

interface Row {
  id: string;
  schoolName: string;
  schoolSlug: string;
  reason: string;
  requestedBy: string;
  purgedAt: string;
  exportKey: string | null;
  exportExpiresAt: string | null;
}

export default function DeletedSchoolsPage() {
  const list = usePlatformApi<Row[]>("/deleted-schools");
  const toast = useToast();
  const columns: Column<Row>[] = [
    { id: "name", header: "School", cell: (r) => <span className="font-medium">{r.schoolName}</span> },
    { id: "deleted", header: "Deleted", cell: (r) => day(r.purgedAt) },
    { id: "by", header: "Requested by", cell: (r) => r.requestedBy },
    { id: "reason", header: "Reason", cell: (r) => r.reason },
    {
      id: "copy",
      header: "Saved copy",
      cell: (r) =>
        r.exportKey ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            icon={<Download />}
            onClick={() => downloadPlatformFile(`/deleted-schools/${r.id}/export`, `${r.schoolSlug}-data.zip`).catch((e: Error) => toast.error("Download failed", e.message))}
          >
            Download (until {day(r.exportExpiresAt!)})
          </Button>
        ) : (
          <span className="text-fg-secondary">Removed</span>
        ),
    },
  ];
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Deleted schools" description="Unpaid trial schools that were removed. A copy of their data is kept for 90 days." />
      <DataTable label="Deleted schools" columns={columns} data={list.data} getRowId={(r) => r.id} error={list.error} onRetry={list.reload} />
    </div>
  );
}
