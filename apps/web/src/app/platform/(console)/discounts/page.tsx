"use client";

import { useState, type FormEvent } from "react";
import { Percent, Plus } from "lucide-react";
import { Alert, Button, Card, DataTable, Dialog, PageHeader, SelectField, StatusPill, TextField, useToast, type Column } from "@/components/ui";
import { useConsoleAdmin } from "@/components/platform/session";
import { platformApi } from "@/lib/api";
import { day, rupees, todayIso } from "@/lib/format";
import { usePlatformApi } from "@/lib/use-api";

interface Discount {
  id: string;
  name: string;
  kind: "PERCENT" | "FIXED";
  value: number;
  schoolId: string | null;
  schoolName: string | null;
  startsOn: string;
  endsOn: string | null;
  isActive: boolean;
  timesUsed: number;
  totalTaken: number;
}

const off = (d: Discount) => (d.kind === "PERCENT" ? `${d.value}% off` : `${rupees(d.value)} off`);

/** Discounts off SchoolSyncer's bills: each school gets one on a single bill. */
export default function DiscountsPage() {
  const toast = useToast();
  const isOwner = useConsoleAdmin().role === "OWNER";
  const discounts = usePlatformApi<Discount[]>("/discounts");
  const schools = usePlatformApi<{ id: string; name: string }[]>("/schools");
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [kind, setKind] = useState("PERCENT");

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    try {
      await platformApi("/discounts", {
        method: "POST",
        body: {
          name: String(f.get("name")),
          kind,
          value: Number(f.get("value")),
          schoolId: String(f.get("schoolId") ?? "") || null,
          startsOn: String(f.get("startsOn")),
          endsOn: String(f.get("endsOn") ?? "") || null,
        },
      });
      toast.success("Discount created", "The next bill it applies to takes it off.");
      setCreating(false);
      await discounts.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function toggle(d: Discount) {
    try {
      await platformApi(`/discounts/${d.id}`, { method: "PATCH", body: { isActive: !d.isActive } });
      await discounts.reload();
    } catch (e) {
      toast.error("Could not change the discount", (e as Error).message);
    }
  }

  const columns: Column<Discount>[] = [
    {
      id: "name",
      header: "Discount",
      sortValue: (d) => d.name,
      cell: (d) => (
        <>
          <span className="font-medium text-fg">{d.name}</span>
          <span className="block text-xs text-fg-secondary">
            {off(d)}, {d.schoolName ?? "every school"}
          </span>
        </>
      ),
    },
    { id: "dates", header: "Dates", cell: (d) => `${day(d.startsOn)} to ${d.endsOn ? day(d.endsOn) : "no end"}`, hideBelow: "md" },
    { id: "used", header: "Used", align: "right", sortValue: (d) => d.timesUsed, cell: (d) => `${d.timesUsed} (${rupees(d.totalTaken)})` },
    { id: "status", header: "Status", cell: (d) => <StatusPill status={d.isActive ? "ACTIVE" : "OFF"} tone={d.isActive ? "success" : "neutral"} label={d.isActive ? "On" : "Off"} /> },
    ...(isOwner
      ? [
          {
            id: "action",
            header: "",
            align: "right" as const,
            cell: (d: Discount) => (
              <Button size="sm" variant="secondary" onClick={() => void toggle(d)}>
                {d.isActive ? "Switch off" : "Switch on"}
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Discounts"
        description="Money off a school's SchoolSyncer bill, taken before tax. A school gets each discount once, and a bill takes the biggest one that applies."
        actions={
          isOwner && (
            <Button icon={<Plus />} onClick={() => { setError(""); setCreating(true); }}>
              New discount
            </Button>
          )
        }
      />
      <Card padding="none">
        <DataTable
          bare
          label="Discounts"
          columns={columns}
          data={discounts.data}
          error={discounts.error}
          onRetry={discounts.reload}
          getRowId={(d) => d.id}
          empty={{ icon: <Percent />, title: "No discounts yet", description: isOwner ? "Create one to take money off bills." : "A SchoolSyncer owner can create discounts." }}
        />
      </Card>

      <Dialog open={creating} onOpenChange={(o) => !saving && setCreating(o)} title="New discount">
        <form onSubmit={create} className="flex flex-col gap-4">
          <TextField label="Name" name="name" required minLength={2} maxLength={60} hint="Shown on the bill, for example Launch offer." />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Type" options={[{ value: "PERCENT", label: "Percent" }, { value: "FIXED", label: "Rupees" }]} value={kind} onChange={(e) => setKind(e.target.value)} />
            <TextField label={kind === "PERCENT" ? "Percent off" : "Rupees off"} name="value" type="number" required min={1} max={kind === "PERCENT" ? 100 : 10_000_000} />
          </div>
          <SelectField
            label="For"
            name="schoolId"
            options={[{ value: "", label: "Every school" }, ...(schools.data?.map((s) => ({ value: s.id, label: s.name })) ?? [])]}
            defaultValue=""
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="From" name="startsOn" type="date" required defaultValue={todayIso()} />
            <TextField label="Until" name="endsOn" type="date" hint="Leave empty for no end date." />
          </div>
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" type="button" onClick={() => setCreating(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Create discount
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
