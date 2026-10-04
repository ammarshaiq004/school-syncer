"use client";

import { useState, type FormEvent } from "react";
import { Building, Plus } from "lucide-react";
import { Alert, Button, DataTable, Drawer, KpiCard, PageHeader, StatGrid, TextField, useToast, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";

interface Campus {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  _count: { classes: number };
}

const FORM_ID = "add-campus-form";

export default function CampusesPage() {
  const campuses = useApi<Campus[]>("/campuses");
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    setBusy(true);
    try {
      await api("/campuses", {
        method: "POST",
        body: {
          name: form.get("name"),
          address: form.get("address") || undefined,
          phone: form.get("phone") || undefined,
        },
      });
      formEl.reset();
      setError("");
      setOpen(false);
      toast.success("Campus added", String(form.get("name") ?? ""));
      await campuses.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<Campus>[] = [
    {
      id: "name",
      header: "Campus",
      sortValue: (c) => c.name,
      cell: (c) => (
        <span className="flex items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary-tint text-brand" aria-hidden>
            <Building className="size-4" />
          </span>
          <span className="font-medium text-fg">{c.name}</span>
        </span>
      ),
    },
    { id: "address", header: "Address", cell: (c) => c.address ?? <span className="text-fg-muted">Not set</span>, hideBelow: "md" },
    { id: "phone", header: "Phone", cell: (c) => c.phone ?? <span className="text-fg-muted">Not set</span>, hideBelow: "sm" },
    { id: "classes", header: "Classes", align: "right", sortValue: (c) => c._count.classes, cell: (c) => c._count.classes },
  ];

  const total = campuses.data?.length ?? 0;
  const classes = campuses.data?.reduce((n, c) => n + c._count.classes, 0) ?? 0;
  const addButton = (
    <Button type="button" icon={<Plus />} onClick={() => setOpen(true)}>
      Add campus
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Campuses"
        description="Every branch of the school. Classes, staff and fees can be kept per campus."
        breadcrumbs={[{ label: "Setup" }, { label: "Campuses" }]}
        actions={addButton}
      />
      <StatGrid cols={2}>
        <KpiCard label="Campuses" value={total} icon={<Building />} error={!campuses.data && !!campuses.error} loading={!campuses.data && !campuses.error} />
        <KpiCard label="Classes across campuses" value={classes} tone="info" error={!campuses.data && !!campuses.error} loading={!campuses.data && !campuses.error} />
      </StatGrid>
      <DataTable
        label="Campuses"
        columns={columns}
        data={campuses.data}
        getRowId={(c) => c.id}
        error={campuses.error}
        onRetry={campuses.reload}
        getSearchText={(c) => `${c.name} ${c.address ?? ""} ${c.phone ?? ""}`}
        searchPlaceholder="Search campuses"
        pageSize={0}
        empty={{ icon: <Building />, title: "No campuses yet", description: "Add your first campus to start creating classes.", action: addButton }}
      />

      <Drawer
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setError("");
        }}
        title="Add a campus"
        description="A branch or building of the school."
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={FORM_ID} loading={busy}>
              Add campus
            </Button>
          </>
        }
      >
        <form id={FORM_ID} onSubmit={onSubmit} className="flex flex-col gap-4">
          <TextField label="Name" name="name" required placeholder="Gulberg campus" />
          <TextField label="Address" name="address" placeholder="45 Main Boulevard, Gulberg III, Lahore" />
          <TextField label="Phone" name="phone" placeholder="042 35761234" />
          {error && <Alert tone="danger">{error}</Alert>}
        </form>
      </Drawer>
    </div>
  );
}
