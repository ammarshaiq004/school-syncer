"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Select } from "@/components/select";
import { Badge, Button, Card, ErrorText, Field, PageTitle, rowClass, tableClass } from "@/components/ui";
import { api } from "@/lib/api";
import { rupees } from "@/lib/format";
import { hasRole, SETUP, useSession } from "@/lib/session";
import { VEHICLE_TYPES, vehicleLabel, type Route, type Vehicle } from "@/lib/transport";
import { useApi } from "@/lib/use-api";

function Seats({ used, total }: { used: number; total: number | null }) {
  if (!total) return <span className="text-sm">{used} riders</span>;
  const full = used >= total;
  return (
    <div className="text-sm">
      <div className="flex justify-between">
        <span>{used} of {total} seats</span>
        {full && <Badge tone="amber">full</Badge>}
      </div>
      <div className="mt-1 h-2 rounded-full bg-black/10 dark:bg-white/10">
        <div className={`h-2 rounded-full ${full ? "bg-amber-500" : "bg-brand"}`} style={{ width: `${Math.min(100, (used / total) * 100)}%` }} />
      </div>
    </div>
  );
}

export default function TransportPage() {
  const user = useSession();
  const canEdit = hasRole(user, SETUP);
  const [tab, setTab] = useState<"routes" | "vehicles">("routes");
  const routes = useApi<Route[]>("/transport/routes");
  const vehicles = useApi<Vehicle[]>("/transport/vehicles");
  const campuses = useApi<{ id: string; name: string }[]>("/campuses");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>, path: string, body: (f: FormData) => unknown, after: () => Promise<void>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    setError("");
    try {
      await api(path, { method: "POST", body: body(new FormData(formEl)) });
      formEl.reset();
      await after();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function toggleVehicle(v: Vehicle) {
    setError("");
    try {
      await api(`/transport/vehicles/${v.id}`, { method: "PATCH", body: { isActive: !v.isActive } });
      await vehicles.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const active = routes.data?.filter((r) => r.isActive) ?? [];
  const riders = active.reduce((a, r) => a + r.riders, 0);
  const billing = active.reduce((a, r) => a + r.monthlyBilling, 0);
  const multiCampus = (campuses.data?.length ?? 0) > 1;

  return (
    <div className="flex flex-col gap-6">
      <PageTitle>Transport</PageTitle>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><div className="text-sm opacity-60">Students using transport</div><div className="mt-1 text-2xl font-semibold">{riders}</div></Card>
        <Card><div className="text-sm opacity-60">Routes</div><div className="mt-1 text-2xl font-semibold">{active.length}</div></Card>
        <Card><div className="text-sm opacity-60">Transport fees a month</div><div className="mt-1 text-2xl font-semibold">{rupees(billing)}</div></Card>
      </div>

      <div className="flex gap-1 border-b border-black/10 dark:border-white/10">
        {(["routes", "vehicles"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${tab === t ? "border-brand font-medium text-brand" : "border-transparent opacity-70"}`}
          >
            {t === "routes" ? "Routes" : "Vans and buses"}
          </button>
        ))}
      </div>
      <ErrorText>{error || routes.error || vehicles.error}</ErrorText>

      {tab === "routes" ? (
        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <div className="grid gap-4 md:grid-cols-2">
            {routes.data?.map((r) => (
              <Link key={r.id} href={`/transport/routes/${r.id}`}>
                <Card className={`h-full hover:border-brand ${r.isActive ? "" : "opacity-60"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-semibold">{r.name}</h2>
                    {!r.isActive && <Badge>closed</Badge>}
                  </div>
                  <p className="text-sm opacity-70">
                    {multiCampus && `${r.campus?.name ?? "All campuses"} · `}
                    {r.stops.length} stops · {rupees(r.monthlyFee)} a month
                  </p>
                  <p className="mt-2 text-sm">
                    {r.vehicle ? `${vehicleLabel(r.vehicle)} · ${r.vehicle.driverName}` : <span className="text-amber-700 dark:text-amber-300">No vehicle yet</span>}
                  </p>
                  <div className="mt-3"><Seats used={r.riders} total={r.vehicle?.capacity ?? null} /></div>
                </Card>
              </Link>
            ))}
            {routes.data?.length === 0 && <p className="text-sm opacity-60">No routes yet. Add your vans first, then a route for each.</p>}
          </div>
          {canEdit && (
            <Card>
              <h2 className="mb-4 font-semibold">Add a route</h2>
              <form
                className="flex flex-col gap-3"
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
                  )
                }
              >
                <Field label="Name" name="name" placeholder="Route 5: Bahria Town" required />
                <Field label="Monthly fee (Rs)" name="monthlyFee" type="number" min={0} required />
                <Select
                  label="Vehicle"
                  name="vehicleId"
                  options={[{ value: "", label: "Choose later" }, ...(vehicles.data ?? []).filter((v) => v.isActive).map((v) => ({ value: v.id, label: `${vehicleLabel(v)} (${v.capacity} seats)` }))]}
                />
                {multiCampus && (
                  <Select
                    label="Campus"
                    name="campusId"
                    options={[{ value: "", label: "All campuses" }, ...(campuses.data ?? []).map((c) => ({ value: c.id, label: c.name }))]}
                  />
                )}
                <Button type="submit">Add route</Button>
                <p className="text-xs opacity-60">Add stops and riders on the route&apos;s page.</p>
              </form>
            </Card>
          )}
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <Card className="overflow-x-auto">
            <table className={tableClass}>
              <thead className="opacity-60">
                <tr><th className="py-2">Vehicle</th><th>Seats</th><th>Driver</th><th>Conductor</th><th>Routes</th><th /></tr>
              </thead>
              <tbody>
                {vehicles.data?.map((v) => (
                  <tr key={v.id} className={`${rowClass} ${v.isActive ? "" : "opacity-50"}`}>
                    <td className="py-2 font-medium">{vehicleLabel(v)}</td>
                    <td>{v.capacity}</td>
                    <td>{v.driverName}<div className="text-xs opacity-60">{v.driverPhone}</div></td>
                    <td>{v.conductorName ?? "–"}{v.conductorPhone && <div className="text-xs opacity-60">{v.conductorPhone}</div>}</td>
                    <td>{v.routes?.map((r) => r.name).join(", ") || "–"}</td>
                    <td className="text-right">
                      {canEdit && (
                        <button className="text-sm text-brand" onClick={() => toggleVehicle(v)}>{v.isActive ? "Retire" : "Bring back"}</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {vehicles.data?.length === 0 && <p className="py-4 text-sm opacity-60">No vehicles yet.</p>}
          </Card>
          {canEdit && (
            <Card>
              <h2 className="mb-4 font-semibold">Add a vehicle</h2>
              <form
                className="flex flex-col gap-3"
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
                  )
                }
              >
                <Field label="Registration number" name="registrationNo" placeholder="LEB-1234" required />
                <Select label="Type" name="type" options={VEHICLE_TYPES} />
                <Field label="Seats for students" name="capacity" type="number" min={1} required />
                <Field label="Driver's name" name="driverName" required />
                <Field label="Driver's phone" name="driverPhone" placeholder="03001234567" required />
                <Field label="Driver's CNIC" name="driverCnic" placeholder="35202-1234567-1" />
                <Field label="Conductor's name" name="conductorName" />
                <Field label="Conductor's phone" name="conductorPhone" />
                <Button type="submit">Add vehicle</Button>
              </form>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
