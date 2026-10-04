"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Armchair, Banknote, Bus, BusFront, MapPin, Phone, Plus, Route as RouteIcon, RotateCcw, Ban, Users } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  Drawer,
  EmptyState,
  ErrorState,
  Field,
  KpiCard,
  PageHeader,
  ProgressBar,
  SearchInput,
  SelectField,
  SkeletonCards,
  StatGrid,
  StatusPill,
  TabPanel,
  Tabs,
  useToast,
  type Column,
} from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { rupees } from "@/lib/format";
import { hasRole, SETUP, useSession } from "@/lib/session";
import { VEHICLE_TYPES, vehicleLabel, type Route, type Vehicle } from "@/lib/transport";
import { useApi } from "@/lib/use-api";

function Seats({ used, total }: { used: number; total: number | null }) {
  if (!total) return <span className="text-[13px] text-fg-secondary tabular-nums">{used} riders</span>;
  const full = used >= total;
  return (
    <div className="flex items-end gap-2">
      <ProgressBar className="flex-1" label="Seats" valueText={`${used} of ${total}`} value={Math.min(used, total)} max={total} size="sm" tone={full ? "warning" : "primary"} />
      {full && <StatusPill status="FULL" tone="warning" label="Full" />}
    </div>
  );
}

type Tab = "routes" | "vehicles";

export default function TransportPage() {
  const user = useSession();
  const canEdit = hasRole(user, SETUP);
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("routes");
  const routes = useApi<Route[]>("/transport/routes");
  const vehicles = useApi<Vehicle[]>("/transport/vehicles");
  const campuses = useApi<{ id: string; name: string }[]>("/campuses");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [drawer, setDrawer] = useState<"" | "route" | "vehicle">("");
  const [search, setSearch] = useState("");
  const [toggling, setToggling] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>, path: string, body: (f: FormData) => unknown, after: () => Promise<void>, done: string) {
    event.preventDefault();
    const formEl = event.currentTarget;
    setError("");
    setSaving(true);
    try {
      await api(path, { method: "POST", body: body(new FormData(formEl)) });
      formEl.reset();
      await after();
      setDrawer("");
      toast.success(done);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleVehicle(v: Vehicle) {
    setToggling(v.id);
    try {
      await api(`/transport/vehicles/${v.id}`, { method: "PATCH", body: { isActive: !v.isActive } });
      await vehicles.reload();
      toast.success(v.isActive ? `${v.registrationNo} retired` : `${v.registrationNo} is back in service`);
    } catch (e) {
      toast.error("Could not update the vehicle", (e as Error).message);
    } finally {
      setToggling(null);
    }
  }

  function openDrawer(kind: "route" | "vehicle") {
    setError("");
    setDrawer(kind);
  }

  const active = routes.data?.filter((r) => r.isActive) ?? [];
  const riders = active.reduce((a, r) => a + r.riders, 0);
  const billing = active.reduce((a, r) => a + r.monthlyBilling, 0);
  const seats = active.reduce((a, r) => a + (r.vehicle?.capacity ?? 0), 0);
  const seated = active.reduce((a, r) => a + (r.vehicle ? r.riders : 0), 0);
  const multiCampus = (campuses.data?.length ?? 0) > 1;
  const routesLoading = !routes.data && !routes.error;
  const shownRoutes = (routes.data ?? [])
    .filter((r) => !search.trim() || `${r.name} ${r.vehicle?.registrationNo ?? ""} ${r.vehicle?.driverName ?? ""} ${r.stops.map((s) => s.name).join(" ")}`.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => Number(b.isActive) - Number(a.isActive));

  const vehicleColumns: Column<Vehicle>[] = [
    {
      id: "vehicle",
      header: "Vehicle",
      sortValue: (v) => v.registrationNo,
      cell: (v) => (
        <span className="flex items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary-tint text-brand" aria-hidden><BusFront className="size-4" /></span>
          <span className="font-medium">{vehicleLabel(v)}</span>
        </span>
      ),
    },
    { id: "seats", header: "Seats", align: "right", sortValue: (v) => v.capacity, cell: (v) => v.capacity },
    {
      id: "driver",
      header: "Driver",
      sortValue: (v) => v.driverName,
      cell: (v) => (
        <span className="block">
          <span className="block">{v.driverName}</span>
          <a className="text-xs text-brand hover:underline" href={`tel:${v.driverPhone}`}>{v.driverPhone}</a>
        </span>
      ),
    },
    {
      id: "conductor",
      header: "Conductor",
      hideBelow: "lg",
      cell: (v) => (
        <span className="block">
          <span className="block">{v.conductorName ?? "–"}</span>
          {v.conductorPhone && <a className="text-xs text-brand hover:underline" href={`tel:${v.conductorPhone}`}>{v.conductorPhone}</a>}
        </span>
      ),
    },
    { id: "routes", header: "Routes", hideBelow: "md", cell: (v) => v.routes?.map((r) => r.name).join(", ") || <span className="text-fg-muted">Not on a route</span> },
    { id: "status", header: "Status", sortValue: (v) => Number(v.isActive), cell: (v) => <StatusPill status={v.isActive ? "ACTIVE" : "INACTIVE"} label={v.isActive ? "In service" : "Retired"} /> },
    ...(canEdit
      ? [{
          id: "actions",
          header: <span className="sr-only">Actions</span>,
          align: "right" as const,
          cell: (v: Vehicle) => (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              icon={v.isActive ? <Ban /> : <RotateCcw />}
              loading={toggling === v.id}
              onClick={() => toggleVehicle(v)}
              aria-label={`${v.isActive ? "Retire" : "Bring back"} ${v.registrationNo}`}
            >
              {v.isActive ? "Retire" : "Bring back"}
            </Button>
          ),
        }]
      : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Transport"
        description="School vans and buses, their routes and stops, and the students who ride them."
        breadcrumbs={[{ label: "Operations" }, { label: "Transport" }]}
        actions={
          canEdit && (
            <>
              <Button variant="secondary" icon={<Bus />} onClick={() => openDrawer("vehicle")}>Add vehicle</Button>
              <Button icon={<Plus />} onClick={() => openDrawer("route")}>Add route</Button>
            </>
          )
        }
      />

      <StatGrid>
        <KpiCard label="Students using transport" value={riders.toLocaleString("en-PK")} icon={<Users />} loading={routesLoading} />
        <KpiCard label="Active routes" value={active.length} icon={<RouteIcon />} tone="info" loading={routesLoading} hint={routes.data && routes.data.length > active.length ? `${routes.data.length - active.length} closed` : undefined} />
        <KpiCard label="Transport fees a month" value={rupees(billing)} icon={<Banknote />} tone="success" loading={routesLoading} />
        <KpiCard
          label="Seats filled"
          value={seats ? `${Math.round((seated / seats) * 100)}%` : "–"}
          icon={<Armchair />}
          tone={seats && seated >= seats ? "warning" : "neutral"}
          loading={routesLoading}
          hint={seats ? `${seated} of ${seats} seats` : "No vehicles on routes yet"}
        />
      </StatGrid>

      <Tabs
        aria-label="Transport sections"
        value={tab}
        onValueChange={(v) => setTab(v as Tab)}
        tabs={[
          { value: "routes", label: "Routes", icon: <RouteIcon />, count: routes.data?.length },
          { value: "vehicles", label: "Vans and buses", icon: <BusFront />, count: vehicles.data?.length },
        ]}
      >
        <TabPanel value="routes">
          <div className="flex flex-col gap-4">
            {!!routes.data?.length && (
              <SearchInput
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onClear={() => setSearch("")}
                placeholder="Search route, stop, vehicle or driver"
                wrapperClassName="w-full sm:w-80"
              />
            )}
            {routes.error ? (
              <ErrorState message={routes.error} onRetry={routes.reload} />
            ) : routesLoading ? (
              <SkeletonCards count={4} />
            ) : routes.data!.length === 0 ? (
              <Card padding="none">
                <EmptyState
                  icon={<RouteIcon />}
                  title="No routes yet"
                  description="Add your vans first, then a route for each."
                  action={canEdit ? <Button icon={<Plus />} onClick={() => openDrawer("route")}>Add route</Button> : undefined}
                />
              </Card>
            ) : shownRoutes.length === 0 ? (
              <Card padding="none">
                <EmptyState compact title="No matching routes" description="Try a different search." action={<Button size="sm" variant="secondary" onClick={() => setSearch("")}>Clear search</Button>} />
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {shownRoutes.map((r) => (
                  <Link key={r.id} href={`/transport/routes/${r.id}`} className="rounded-xl focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring">
                    <Card interactive className={cn("flex h-full flex-col gap-3", !r.isActive && "bg-surface-2")}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h2 className="truncate text-base font-semibold text-fg">{r.name}</h2>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-fg-muted">
                            {multiCampus && <span>{r.campus?.name ?? "All campuses"}</span>}
                            <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" aria-hidden />{r.stops.length} stops</span>
                            <span className="tabular-nums">{rupees(r.monthlyFee)} a month</span>
                          </p>
                        </div>
                        {!r.isActive && <StatusPill status="CLOSED" />}
                      </div>
                      <div className="text-[13px]">
                        {r.vehicle ? (
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-fg-secondary">
                            <Badge tone="neutral" icon={<BusFront />}>{vehicleLabel(r.vehicle)}</Badge>
                            <span className="inline-flex items-center gap-1"><Phone className="size-3.5 text-fg-muted" aria-hidden />{r.vehicle.driverName}</span>
                          </span>
                        ) : (
                          <StatusPill status="PENDING" label="No vehicle yet" />
                        )}
                      </div>
                      <div className="mt-auto"><Seats used={r.riders} total={r.vehicle?.capacity ?? null} /></div>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </TabPanel>
        <TabPanel value="vehicles">
          <DataTable
            label="Vans and buses"
            columns={vehicleColumns}
            data={vehicles.data}
            error={vehicles.error}
            onRetry={vehicles.reload}
            getRowId={(v) => v.id}
            getSearchText={(v) => `${v.registrationNo} ${v.driverName} ${v.driverPhone} ${v.conductorName ?? ""} ${v.routes?.map((r) => r.name).join(" ") ?? ""}`}
            searchPlaceholder="Search registration, driver or route"
            defaultSort={{ id: "status", dir: "desc" }}
            rowClassName={(v) => (v.isActive ? undefined : "text-fg-muted")}
            toolbarActions={canEdit ? <Button size="sm" variant="secondary" icon={<Plus />} onClick={() => openDrawer("vehicle")}>Add vehicle</Button> : undefined}
            empty={{ title: "No vehicles yet", description: "Add each van or bus with its driver's details.", icon: <BusFront /> }}
          />
        </TabPanel>
      </Tabs>

      {canEdit && (
        <>
          <Drawer
            open={drawer === "route"}
            onOpenChange={(o) => !o && setDrawer("")}
            title="Add a route"
            description="Add stops and riders on the route's page."
            footer={
              <>
                <Button type="button" variant="secondary" onClick={() => setDrawer("")}>Cancel</Button>
                <Button type="submit" form="add-route" icon={<Plus />} loading={saving}>Add route</Button>
              </>
            }
          >
            <form
              id="add-route"
              className="flex flex-col gap-4"
              onSubmit={(e) =>
                submit(
                  e,
                  "/transport/routes",
                  (f) => ({
                    name: f.get("name"),
                    monthlyFee: Number(f.get("monthlyFee")),
                    vehicleId: f.get("vehicleId") || null,
                    campusId: f.get("campusId") || null,
                  }),
                  routes.reload,
                  "Route added",
                )
              }
            >
              {error && <Alert tone="danger">{error}</Alert>}
              <Field label="Name" name="name" placeholder="Route 5: Bahria Town" required />
              <Field label="Monthly fee (Rs)" name="monthlyFee" type="number" min={0} required />
              <SelectField
                label="Vehicle"
                name="vehicleId"
                options={[{ value: "", label: "Choose later" }, ...(vehicles.data ?? []).filter((v) => v.isActive).map((v) => ({ value: v.id, label: `${vehicleLabel(v)} (${v.capacity} seats)` }))]}
              />
              {multiCampus && (
                <SelectField
                  label="Campus"
                  name="campusId"
                  options={[{ value: "", label: "All campuses" }, ...(campuses.data ?? []).map((c) => ({ value: c.id, label: c.name }))]}
                />
              )}
            </form>
          </Drawer>

          <Drawer
            open={drawer === "vehicle"}
            onOpenChange={(o) => !o && setDrawer("")}
            title="Add a vehicle"
            description="The driver's phone is shown to parents of riders."
            footer={
              <>
                <Button type="button" variant="secondary" onClick={() => setDrawer("")}>Cancel</Button>
                <Button type="submit" form="add-vehicle" icon={<Plus />} loading={saving}>Add vehicle</Button>
              </>
            }
          >
            <form
              id="add-vehicle"
              className="flex flex-col gap-4"
              onSubmit={(e) =>
                submit(
                  e,
                  "/transport/vehicles",
                  (f) => ({
                    registrationNo: f.get("registrationNo"),
                    type: f.get("type"),
                    capacity: Number(f.get("capacity")),
                    driverName: f.get("driverName"),
                    driverPhone: f.get("driverPhone"),
                    driverCnic: f.get("driverCnic") || null,
                    conductorName: f.get("conductorName") || null,
                    conductorPhone: f.get("conductorPhone") || null,
                  }),
                  vehicles.reload,
                  "Vehicle added",
                )
              }
            >
              {error && <Alert tone="danger">{error}</Alert>}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Registration number" name="registrationNo" placeholder="LEB-1234" required />
                <SelectField label="Type" name="type" options={VEHICLE_TYPES} />
                <Field label="Seats for students" name="capacity" type="number" min={1} required />
              </div>
              <fieldset className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
                <legend className="sr-only">Driver</legend>
                <Field label="Driver's name" name="driverName" required />
                <Field label="Driver's phone" name="driverPhone" placeholder="03001234567" required />
                <Field label="Driver's CNIC" name="driverCnic" placeholder="35202-1234567-1" />
              </fieldset>
              <fieldset className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
                <legend className="sr-only">Conductor</legend>
                <Field label="Conductor's name" name="conductorName" />
                <Field label="Conductor's phone" name="conductorPhone" />
              </fieldset>
            </form>
          </Drawer>
        </>
      )}
    </div>
  );
}
