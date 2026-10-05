"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ArrowDown, ArrowUp, Armchair, Banknote, BusFront, Clock, MapPin, Plus, Printer, Save, Settings2, Trash2, UserPlus, UserX, Users } from "lucide-react";
import {
  Alert,
  Avatar,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  DataTable,
  DescriptionList,
  Drawer,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  KpiCard,
  PageHeader,
  ProgressBar,
  SearchInput,
  SelectField,
  SkeletonCards,
  SkeletonRows,
  StatGrid,
  StatusPill,
  TextField,
  useToast,
  type Column,
} from "@/components/ui";
import { api } from "@/lib/api";
import { day, fullName, rupees, todayIso } from "@/lib/format";
import { hasRole, SETUP, useSession } from "@/lib/session";
import { stopLabel, vehicleLabel, type Route, type Stop, type Vehicle } from "@/lib/transport";
import { useApi } from "@/lib/use-api";

interface Rider {
  assignmentId: string;
  studentId: string;
  name: string;
  admissionNo: string;
  class: string | null;
  stopId: string | null;
  stop: string | null;
  pickupTime: string | null;
  dropTime: string | null;
  fee: number;
  since: string;
  phones: string[];
}

type Detail = Omit<Route, "riders" | "monthlyBilling"> & { riders: Rider[] };

interface StudentHit {
  id: string;
  firstName: string;
  lastName: string | null;
  admissionNo: string;
  enrollments: { section: { name: string; class: { name: string } } }[];
}

type StopDraft = { id?: string; name: string; pickupTime: string; dropTime: string; monthlyFee: string };
const toDraft = (s: Stop): StopDraft => ({
  id: s.id,
  name: s.name,
  pickupTime: s.pickupTime ?? "",
  dropTime: s.dropTime ?? "",
  monthlyFee: s.monthlyFee?.toString() ?? "",
});

type PanelProps = { route: Detail; open: boolean; onOpenChange: (o: boolean) => void };

function StopsEditor({ route, open, onOpenChange, onSaved }: PanelProps & { onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [stops, setStops] = useState<StopDraft[]>(route.stops.map(toDraft));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (i: number, patch: Partial<StopDraft>) => setStops(stops.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, by: number) => {
    const next = [...stops];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    setStops(next);
  };

  async function save() {
    setError("");
    setSaving(true);
    try {
      await api(`/transport/routes/${route.id}/stops`, {
        method: "PUT",
        body: {
          stops: stops.map((s) => ({
            id: s.id,
            name: s.name,
            pickupTime: s.pickupTime || null,
            dropTime: s.dropTime || null,
            monthlyFee: s.monthlyFee === "" ? null : Number(s.monthlyFee),
          })),
        },
      });
      toast.success("Stops saved");
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Edit stops"
      description={`In pick-up order. Leave a stop's fee empty to charge the route's ${rupees(route.monthlyFee)}.`}
      footer={
        <>
          <Button type="button" variant="secondary" icon={<Plus />} onClick={() => setStops([...stops, { name: "", pickupTime: "", dropTime: "", monthlyFee: "" }])}>Add a stop</Button>
          <Button type="button" icon={<Save />} loading={saving} onClick={save}>Save stops</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error && <Alert tone="danger">{error}</Alert>}
        {stops.length === 0 && <EmptyState compact icon={<MapPin />} title="No stops yet" description="Add the first stop on this route." />}
        <ol className="flex flex-col gap-3">
          {stops.map((s, i) => (
            <li key={s.id ?? `new-${i}`} className="flex gap-3 rounded-lg border border-border bg-surface-2 p-3">
              <span className="mt-1.5 grid size-6 shrink-0 place-items-center rounded-full bg-primary-tint text-xs font-semibold text-brand tabular-nums" aria-hidden>{i + 1}</span>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Input className="h-9" value={s.name} onChange={(e) => set(i, { name: e.target.value })} aria-label={`Stop ${i + 1} name`} placeholder="Stop name" />
                <div className="grid grid-cols-3 gap-2">
                  <label className="flex flex-col gap-1 text-xs text-fg-muted">Pick-up<Input type="time" className="h-9" value={s.pickupTime} onChange={(e) => set(i, { pickupTime: e.target.value })} aria-label={`Stop ${i + 1} pick-up time`} /></label>
                  <label className="flex flex-col gap-1 text-xs text-fg-muted">Drop<Input type="time" className="h-9" value={s.dropTime} onChange={(e) => set(i, { dropTime: e.target.value })} aria-label={`Stop ${i + 1} drop time`} /></label>
                  <label className="flex flex-col gap-1 text-xs text-fg-muted">Own fee<Input type="number" min={0} className="h-9 tabular-nums" placeholder={String(route.monthlyFee)} value={s.monthlyFee} onChange={(e) => set(i, { monthlyFee: e.target.value })} aria-label={`Stop ${i + 1} own fee`} /></label>
                </div>
              </div>
              <div className="flex shrink-0 flex-col gap-0.5">
                <IconButton size="sm" aria-label={`Move ${s.name || `stop ${i + 1}`} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp /></IconButton>
                <IconButton size="sm" aria-label={`Move ${s.name || `stop ${i + 1}`} down`} disabled={i === stops.length - 1} onClick={() => move(i, 1)}><ArrowDown /></IconButton>
                <IconButton size="sm" aria-label={`Remove ${s.name || `stop ${i + 1}`}`} onClick={() => setStops(stops.filter((_, j) => j !== i))}><Trash2 /></IconButton>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </Drawer>
  );
}

function RouteSettings({ route, open, onOpenChange, onSaved }: PanelProps & { onSaved: () => Promise<void> }) {
  const toast = useToast();
  const vehicles = useApi<Vehicle[]>("/transport/vehicles");
  const [name, setName] = useState(route.name);
  const [fee, setFee] = useState(String(route.monthlyFee));
  const [vehicleId, setVehicleId] = useState(route.vehicleId ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function save(body: Record<string, unknown>, done: string) {
    setError("");
    setSaving(true);
    try {
      await api(`/transport/routes/${route.id}`, { method: "PATCH", body });
      toast.success(done);
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="Route settings"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" icon={<Save />} loading={saving} onClick={() => save({ name, monthlyFee: Number(fee), vehicleId: vehicleId || null }, "Route saved")}>Save</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <TextField label="Monthly fee (Rs)" type="number" min={0} value={fee} onChange={(e) => setFee(e.target.value)} />
        <SelectField
          label="Vehicle"
          value={vehicleId}
          onChange={(e) => setVehicleId(e.target.value)}
          options={[
            { value: "", label: "None" },
            ...(vehicles.data ?? []).filter((v) => v.isActive || v.id === route.vehicleId).map((v) => ({ value: v.id, label: `${vehicleLabel(v)} (${v.capacity} seats)` })),
          ]}
          hint={vehicles.error ? `Could not load vehicles: ${vehicles.error}` : undefined}
        />
        <div className="mt-2 flex flex-col gap-2 rounded-lg border border-border p-4">
          <p className="text-sm font-medium text-fg">{route.isActive ? "Close this route" : "Reopen this route"}</p>
          <p className="text-[13px] text-fg-muted">{route.isActive ? "A closed route stays on record but is hidden from new assignments." : "Reopening lets you add riders again."}</p>
          <div>
            <Button
              type="button"
              size="sm"
              variant={route.isActive ? "danger" : "secondary"}
              disabled={saving}
              onClick={() => save({ isActive: !route.isActive }, route.isActive ? "Route closed" : "Route reopened")}
            >
              {route.isActive ? "Close route" : "Reopen route"}
            </Button>
          </div>
        </div>
      </div>
    </Drawer>
  );
}

function AddRider({ route, open, onOpenChange, onAdded }: PanelProps & { onAdded: () => Promise<void> }) {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const query = search.trim().length >= 2 ? `/students?search=${encodeURIComponent(search.trim())}` : null;
  const hits = useApi<StudentHit[]>(query);
  const [stopId, setStopId] = useState(route.stops[0]?.id ?? "");
  const [startsOn, setStartsOn] = useState(todayIso());
  const [error, setError] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  const onRoute = new Set(route.riders.map((r) => r.studentId));

  async function add(s: StudentHit) {
    setError("");
    setAdding(s.id);
    try {
      await api("/transport/assignments", { method: "POST", body: { studentId: s.id, routeId: route.id, stopId: stopId || null, startsOn } });
      toast.success(`${fullName(s)} added.`);
      setSearch("");
      await onAdded();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAdding(null);
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} title="Add riders" description="A student on another route is moved here; their old route ends the day before.">
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Stop"
            value={stopId}
            onChange={(e) => setStopId(e.target.value)}
            options={[{ value: "", label: "No set stop" }, ...route.stops.map((s) => ({ value: s.id, label: stopLabel(s) }))]}
          />
          <TextField label="From" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
        </div>
        <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} onClear={() => setSearch("")} placeholder="Search a student by name or admission no." />
        {error && <Alert tone="danger">{error}</Alert>}
        {!query ? (
          <p className="text-[13px] text-fg-muted">Type at least two letters to find a student.</p>
        ) : hits.error ? (
          <ErrorState compact message={hits.error} onRetry={hits.reload} />
        ) : !hits.data ? (
          <SkeletonRows rows={3} columns={2} />
        ) : hits.data.length === 0 ? (
          <EmptyState compact title="No students match" description="Check the spelling or try the admission number." />
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {hits.data.slice(0, 15).map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <span className="flex min-w-0 items-center gap-2.5">
                  <Avatar name={fullName(s)} size="sm" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-fg">{fullName(s)}</span>
                    <span className="block truncate text-xs text-fg-muted">
                      {s.admissionNo}{s.enrollments[0] && `, ${s.enrollments[0].section.class.name} ${s.enrollments[0].section.name}`}
                    </span>
                  </span>
                </span>
                {onRoute.has(s.id) ? (
                  <StatusPill status="ACTIVE" label="On this route" />
                ) : (
                  <Button type="button" size="sm" variant="secondary" icon={<Plus />} loading={adding === s.id} onClick={() => add(s)} aria-label={`Add ${fullName(s)}`}>Add</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Drawer>
  );
}

export default function RoutePage() {
  const { id } = useParams<{ id: string }>();
  const user = useSession();
  const canEdit = hasRole(user, SETUP);
  const toast = useToast();
  const route = useApi<Detail>(`/transport/routes/${id}`);
  const [panel, setPanel] = useState<"" | "stops" | "settings" | "add">("");
  const [stopping, setStopping] = useState<Rider | null>(null);
  const [busy, setBusy] = useState(false);
  const r = route.data;

  async function stopRide() {
    if (!stopping) return;
    setBusy(true);
    try {
      await api(`/transport/assignments/${stopping.assignmentId}/end`, { method: "POST", body: {} });
      toast.success(`${stopping.name}'s transport stopped`);
      setStopping(null);
      await route.reload();
    } catch (e) {
      toast.error("Could not stop transport", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const crumbs = [{ label: "Transport", href: "/transport" }, { label: r?.name ?? "Route" }];
  if (!r)
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Route" breadcrumbs={crumbs} />
        {route.error ? <ErrorState message={route.error} onRetry={route.reload} /> : <><SkeletonCards count={4} /><SkeletonRows rows={5} /></>}
      </div>
    );

  const v = r.vehicle;
  const reload = async () => {
    await route.reload();
    setPanel("");
  };
  const panelProps = (p: "stops" | "settings" | "add") => ({ route: r, open: panel === p, onOpenChange: (o: boolean) => setPanel(o ? p : "") });

  const riderColumns: Column<Rider>[] = [
    {
      id: "student",
      header: "Student",
      sortValue: (x) => x.name,
      cell: (x) => (
        <span className="block">
          <Link href={`/students/${x.studentId}`} className="font-medium text-fg hover:text-brand print:text-inherit">{x.name}</Link>
          <span className="text-xs text-fg-muted"> · {x.admissionNo}</span>
        </span>
      ),
    },
    { id: "class", header: "Class", sortValue: (x) => x.class, cell: (x) => x.class ?? "–" },
    {
      id: "phone",
      header: "Parent's phone",
      cell: (x) =>
        x.phones.length ? (
          <span className="flex flex-wrap gap-x-2">
            {x.phones.map((p) => <a key={p} className="tabular-nums text-brand hover:underline print:text-inherit" href={`tel:${p}`}>{p}</a>)}
          </span>
        ) : "–",
    },
    { id: "since", header: "Since", sortValue: (x) => x.since, cell: (x) => day(x.since), hideBelow: "sm" },
    ...(canEdit
      ? [{
          id: "actions",
          header: <span className="sr-only">Actions</span>,
          align: "right" as const,
          className: "print:hidden",
          headerClassName: "print:hidden",
          cell: (x: Rider) => (
            <Button type="button" size="sm" variant="ghost" icon={<UserX />} onClick={() => setStopping(x)} aria-label={`Stop transport for ${x.name}`}>Stop</Button>
          ),
        }]
      : []),
  ];

  const groups = [...r.stops.map((s) => ({ stop: s as Stop | null, key: s.id })), { stop: null, key: "none" }]
    .map(({ stop, key }) => ({ stop, key, here: r.riders.filter((x) => x.stopId === (stop?.id ?? null)) }))
    .filter((g) => g.stop || g.here.length);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={r.name}
        breadcrumbs={crumbs}
        leading={<span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary-tint text-brand" aria-hidden><BusFront className="size-5" /></span>}
        description={`${r.campus ? `${r.campus.name}, ` : ""}${rupees(r.monthlyFee)} a month, ${r.riders.length} riders${v ? ` of ${v.capacity} seats` : ""}`}
        meta={<StatusPill status={r.isActive ? "ACTIVE" : "CLOSED"} />}
        actions={
          <>
            {canEdit && (
              <>
                <Button variant="secondary" icon={<Settings2 />} onClick={() => setPanel("settings")}>Route settings</Button>
                <Button variant="secondary" icon={<MapPin />} onClick={() => setPanel("stops")}>Edit stops</Button>
                <Button variant="secondary" icon={<UserPlus />} onClick={() => setPanel("add")} disabled={!r.isActive}>Add riders</Button>
              </>
            )}
            <Button icon={<Printer />} onClick={() => window.print()}>Print driver&apos;s list</Button>
          </>
        }
      />

      {/* Shown only on paper: the PageHeader is hidden when printing. */}
      <div className="hidden print:block">
        <h1 className="text-2xl font-semibold">{r.name}</h1>
        <p className="text-sm">
          {r.campus ? `${r.campus.name} · ` : ""}
          {rupees(r.monthlyFee)} a month · {r.riders.length} riders{v && ` of ${v.capacity} seats`}
          {!r.isActive && " · closed"}
        </p>
      </div>

      <StatGrid className="print:hidden">
        <KpiCard label="Riders" value={r.riders.length} icon={<Users />} hint={v ? `${Math.max(0, v.capacity - r.riders.length)} seats free` : undefined} />
        <KpiCard label="Stops" value={r.stops.length} icon={<MapPin />} tone="info" />
        <KpiCard label="Monthly fee" value={rupees(r.monthlyFee)} icon={<Banknote />} tone="success" hint="Stops can charge their own fee" />
        <KpiCard
          label="Seats filled"
          value={v ? `${Math.round((r.riders.length / v.capacity) * 100)}%` : "–"}
          icon={<Armchair />}
          tone={v && r.riders.length >= v.capacity ? "warning" : "neutral"}
          hint={v ? undefined : "No vehicle yet"}
          sparkline={v ? <ProgressBar className="w-20" size="sm" value={Math.min(r.riders.length, v.capacity)} max={v.capacity} tone={r.riders.length >= v.capacity ? "warning" : "primary"} /> : undefined}
        />
      </StatGrid>

      {v ? (
        <Card className="break-inside-avoid">
          <CardHeader title="Vehicle and crew" icon={<BusFront />} />
          <DescriptionList
            columns={3}
            items={[
              { label: "Vehicle", value: vehicleLabel(v) },
              { label: "Driver", value: <>{v.driverName}, <a className="text-brand hover:underline print:text-inherit" href={`tel:${v.driverPhone}`}>{v.driverPhone}</a></> },
              { label: "Conductor", value: v.conductorName ? <>{v.conductorName}{v.conductorPhone && <>, <a className="text-brand hover:underline print:text-inherit" href={`tel:${v.conductorPhone}`}>{v.conductorPhone}</a></>}</> : "–" },
            ]}
          />
        </Card>
      ) : (
        <Alert tone="warning" title="No vehicle on this route yet." action={canEdit ? <Button size="sm" variant="secondary" onClick={() => setPanel("settings")}>Choose a vehicle</Button> : undefined}>
          Riders can still be added; pick a van in route settings when one is ready.
        </Alert>
      )}

      {r.stops.length === 0 && r.riders.length === 0 && (
        <Card padding="none">
          <EmptyState
            icon={<MapPin />}
            title="No stops or riders yet"
            description="Add the route's stops, then its riders."
            action={canEdit ? <Button icon={<MapPin />} onClick={() => setPanel("stops")}>Add stops</Button> : undefined}
          />
        </Card>
      )}

      {groups.map(({ stop, key, here }, i) => (
        <Card key={key} padding="none" className="break-inside-avoid overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary-tint text-xs font-semibold tabular-nums text-brand" aria-hidden>
                {stop ? i + 1 : "–"}
              </span>
              <h2 className="truncate text-base font-semibold text-fg">{stop ? stop.name : "No set stop"}</h2>
              <span className="text-xs text-fg-muted tabular-nums">{here.length} {here.length === 1 ? "rider" : "riders"}</span>
            </div>
            <span className="flex flex-wrap items-center gap-x-3 text-[13px] text-fg-muted tabular-nums">
              {stop?.pickupTime && <span className="inline-flex items-center gap-1"><Clock className="size-3.5" aria-hidden />Pick-up {stop.pickupTime}</span>}
              {stop?.dropTime && <span>Drop {stop.dropTime}</span>}
              {stop?.monthlyFee != null && <span>{rupees(stop.monthlyFee)} a month</span>}
            </span>
          </div>
          {here.length === 0 ? (
            <p className="border-t border-border px-5 py-4 text-sm text-fg-muted">Nobody picked up here.</p>
          ) : (
            <div className="border-t border-border">
              <DataTable
                bare
                label={`Riders at ${stop ? stop.name : "no set stop"}`}
                columns={riderColumns}
                data={here}
                getRowId={(x) => x.assignmentId}
                pageSize={0}
                defaultSort={{ id: "student", dir: "asc" }}
              />
            </div>
          )}
        </Card>
      ))}

      {canEdit && (
        <>
          <StopsEditor key={`stops-${panel === "stops"}`} {...panelProps("stops")} onSaved={reload} />
          <RouteSettings key={`settings-${panel === "settings"}`} {...panelProps("settings")} onSaved={reload} />
          <AddRider {...panelProps("add")} onAdded={route.reload} />
        </>
      )}

      <ConfirmDialog
        open={!!stopping}
        onOpenChange={(o) => !o && setStopping(null)}
        title={`Stop ${stopping?.name ?? ""}'s transport?`}
        description="Transport stops from today. This month is still charged."
        confirmLabel="Stop transport"
        destructive
        loading={busy}
        onConfirm={stopRide}
      />
    </div>
  );
}
