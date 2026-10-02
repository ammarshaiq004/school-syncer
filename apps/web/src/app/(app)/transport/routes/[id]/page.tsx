"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Badge, Button, Card, ErrorText, Notice, rowClass, tableClass } from "@/components/ui";
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

const inputClass = "rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20";
type StopDraft = { id?: string; name: string; pickupTime: string; dropTime: string; monthlyFee: string };
const toDraft = (s: Stop): StopDraft => ({
  id: s.id,
  name: s.name,
  pickupTime: s.pickupTime ?? "",
  dropTime: s.dropTime ?? "",
  monthlyFee: s.monthlyFee?.toString() ?? "",
});

function StopsEditor({ route, onSaved }: { route: Detail; onSaved: () => Promise<void> }) {
  const [stops, setStops] = useState<StopDraft[]>(route.stops.map(toDraft));
  const [error, setError] = useState("");
  const set = (i: number, patch: Partial<StopDraft>) => setStops(stops.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, by: number) => {
    const next = [...stops];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    setStops(next);
  };

  async function save() {
    setError("");
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
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <table className={tableClass}>
          <thead className="opacity-60">
            <tr><th className="py-2">Stop, in pick-up order</th><th>Pick-up</th><th>Drop</th><th>Own fee</th><th /></tr>
          </thead>
          <tbody>
            {stops.map((s, i) => (
              <tr key={s.id ?? `new-${i}`} className={rowClass}>
                <td className="py-1"><input className={`${inputClass} w-full min-w-40`} value={s.name} onChange={(e) => set(i, { name: e.target.value })} aria-label="Stop name" /></td>
                <td><input type="time" className={inputClass} value={s.pickupTime} onChange={(e) => set(i, { pickupTime: e.target.value })} aria-label="Pick-up time" /></td>
                <td><input type="time" className={inputClass} value={s.dropTime} onChange={(e) => set(i, { dropTime: e.target.value })} aria-label="Drop time" /></td>
                <td><input type="number" min={0} placeholder={String(route.monthlyFee)} className={`${inputClass} w-28`} value={s.monthlyFee} onChange={(e) => set(i, { monthlyFee: e.target.value })} aria-label="Own fee" /></td>
                <td className="whitespace-nowrap">
                  <button className="px-1 disabled:opacity-20" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                  <button className="px-1 disabled:opacity-20" disabled={i === stops.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                  <button className="px-1 text-red-600" onClick={() => setStops(stops.filter((_, j) => j !== i))} aria-label="Remove">✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs opacity-60">Leave a stop&apos;s fee empty to charge the route&apos;s {rupees(route.monthlyFee)}.</p>
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={() => setStops([...stops, { name: "", pickupTime: "", dropTime: "", monthlyFee: "" }])}>Add a stop</Button>
        <Button onClick={save}>Save stops</Button>
      </div>
    </div>
  );
}

function RouteSettings({ route, onSaved }: { route: Detail; onSaved: () => Promise<void> }) {
  const vehicles = useApi<Vehicle[]>("/transport/vehicles");
  const [name, setName] = useState(route.name);
  const [fee, setFee] = useState(String(route.monthlyFee));
  const [vehicleId, setVehicleId] = useState(route.vehicleId ?? "");
  const [error, setError] = useState("");

  async function save(body: Record<string, unknown>) {
    setError("");
    try {
      await api(`/transport/routes/${route.id}`, { method: "PATCH", body });
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      <label className="flex flex-col gap-1"><span className="font-medium">Name</span><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="flex flex-col gap-1"><span className="font-medium">Monthly fee (Rs)</span><input type="number" min={0} className={inputClass} value={fee} onChange={(e) => setFee(e.target.value)} /></label>
      <label className="flex flex-col gap-1">
        <span className="font-medium">Vehicle</span>
        <select className={inputClass} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
          <option value="">None</option>
          {vehicles.data?.filter((v) => v.isActive || v.id === route.vehicleId).map((v) => (
            <option key={v.id} value={v.id}>{vehicleLabel(v)} ({v.capacity} seats)</option>
          ))}
        </select>
      </label>
      <ErrorText>{error}</ErrorText>
      <Button onClick={() => save({ name, monthlyFee: Number(fee), vehicleId: vehicleId || null })}>Save</Button>
      <button className="text-left text-xs opacity-70 hover:opacity-100" onClick={() => save({ isActive: !route.isActive })}>
        {route.isActive ? "Close this route" : "Reopen this route"}
      </button>
    </div>
  );
}

function AddRider({ route, onAdded }: { route: Detail; onAdded: () => Promise<void> }) {
  const [search, setSearch] = useState("");
  const hits = useApi<StudentHit[]>(search.trim().length >= 2 ? `/students?search=${encodeURIComponent(search.trim())}` : null);
  const [stopId, setStopId] = useState(route.stops[0]?.id ?? "");
  const [startsOn, setStartsOn] = useState(todayIso());
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const onRoute = new Set(route.riders.map((r) => r.studentId));

  async function add(s: StudentHit) {
    setError("");
    try {
      await api("/transport/assignments", { method: "POST", body: { studentId: s.id, routeId: route.id, stopId: stopId || null, startsOn } });
      setNotice(`${fullName(s)} added.`);
      setSearch("");
      await onAdded();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      <label className="flex flex-col gap-1">
        <span className="font-medium">Stop</span>
        <select className={inputClass} value={stopId} onChange={(e) => setStopId(e.target.value)}>
          <option value="">No set stop</option>
          {route.stops.map((s) => <option key={s.id} value={s.id}>{stopLabel(s)}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-medium">From</span>
        <input type="date" className={inputClass} value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
      </label>
      <input className={inputClass} placeholder="Search a student by name or admission no." value={search} onChange={(e) => setSearch(e.target.value)} />
      <ul className="max-h-64 overflow-y-auto">
        {hits.data?.slice(0, 15).map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-2 border-t border-black/5 py-1.5 dark:border-white/10">
            <span>
              {fullName(s)} <span className="opacity-60">· {s.admissionNo}{s.enrollments[0] && ` · ${s.enrollments[0].section.class.name} ${s.enrollments[0].section.name}`}</span>
            </span>
            {onRoute.has(s.id) ? <span className="text-xs opacity-60">on this route</span> : <button className="text-brand" onClick={() => add(s)}>Add</button>}
          </li>
        ))}
      </ul>
      <p className="text-xs opacity-60">A student on another route is moved here; their old route ends the day before.</p>
      <ErrorText>{error}</ErrorText>
      <Notice>{notice}</Notice>
    </div>
  );
}

export default function RoutePage() {
  const { id } = useParams<{ id: string }>();
  const user = useSession();
  const canEdit = hasRole(user, SETUP);
  const route = useApi<Detail>(`/transport/routes/${id}`);
  const [panel, setPanel] = useState<"" | "stops" | "settings" | "add">("");
  const [error, setError] = useState("");
  const r = route.data;

  async function stopRide(rider: Rider) {
    if (!confirm(`Stop ${rider.name}'s transport from today? This month is still charged.`)) return;
    setError("");
    try {
      await api(`/transport/assignments/${rider.assignmentId}/end`, { method: "POST", body: {} });
      await route.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!r) return <ErrorText>{route.error}</ErrorText>;
  const v = r.vehicle;
  const reload = async () => {
    await route.reload();
    setPanel("");
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="print:hidden">
        <Link href="/transport" className="text-sm text-brand">← Transport</Link>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{r.name}</h1>
          <p className="text-sm opacity-70">
            {r.campus ? `${r.campus.name} · ` : ""}
            {rupees(r.monthlyFee)} a month · {r.riders.length} riders{v && ` of ${v.capacity} seats`}
            {!r.isActive && " · closed"}
          </p>
          {v ? (
            <p className="mt-1 text-sm">
              {vehicleLabel(v)} · driver {v.driverName}, <a className="text-brand" href={`tel:${v.driverPhone}`}>{v.driverPhone}</a>
              {v.conductorName && <> · conductor {v.conductorName}{v.conductorPhone && `, ${v.conductorPhone}`}</>}
            </p>
          ) : (
            <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">No vehicle on this route yet.</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          {canEdit && (
            <>
              <Button variant={panel === "add" ? "primary" : "ghost"} onClick={() => setPanel(panel === "add" ? "" : "add")}>Add riders</Button>
              <Button variant={panel === "stops" ? "primary" : "ghost"} onClick={() => setPanel(panel === "stops" ? "" : "stops")}>Edit stops</Button>
              <Button variant={panel === "settings" ? "primary" : "ghost"} onClick={() => setPanel(panel === "settings" ? "" : "settings")}>Route settings</Button>
            </>
          )}
          <Button variant="ghost" onClick={() => window.print()}>Print driver&apos;s list</Button>
        </div>
      </div>
      <ErrorText>{error}</ErrorText>

      {panel && (
        <Card className="print:hidden">
          {panel === "stops" && <StopsEditor route={r} onSaved={reload} />}
          {panel === "settings" && <RouteSettings route={r} onSaved={reload} />}
          {panel === "add" && <AddRider route={r} onAdded={route.reload} />}
        </Card>
      )}

      {r.stops.length === 0 && r.riders.length === 0 && <p className="text-sm opacity-60">Add the route&apos;s stops, then its riders.</p>}

      {[...r.stops.map((s) => ({ stop: s as Stop | null, key: s.id })), { stop: null, key: "none" }].map(({ stop, key }) => {
        const here = r.riders.filter((x) => x.stopId === (stop?.id ?? null));
        if (!stop && !here.length) return null;
        return (
          <Card key={key} className="break-inside-avoid overflow-x-auto">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold">{stop ? stop.name : "No set stop"}</h2>
              <span className="text-sm opacity-70">
                {stop?.pickupTime && `Pick-up ${stop.pickupTime}`}
                {stop?.dropTime && ` · drop ${stop.dropTime}`}
                {stop?.monthlyFee != null && ` · ${rupees(stop.monthlyFee)} a month`}
              </span>
            </div>
            {here.length === 0 ? (
              <p className="text-sm opacity-60">Nobody picked up here.</p>
            ) : (
              <table className={tableClass}>
                <thead className="opacity-60">
                  <tr><th className="py-2">Student</th><th>Class</th><th>Parent&apos;s phone</th><th>Since</th><th className="print:hidden" /></tr>
                </thead>
                <tbody>
                  {here.map((x) => (
                    <tr key={x.assignmentId} className={rowClass}>
                      <td className="py-2">
                        <Link href={`/students/${x.studentId}`} className="text-brand print:text-inherit">{x.name}</Link>
                        <span className="text-xs opacity-60"> · {x.admissionNo}</span>
                      </td>
                      <td>{x.class ?? "–"}</td>
                      <td>{x.phones.join(", ") || "–"}</td>
                      <td>{day(x.since)}</td>
                      <td className="text-right print:hidden">
                        {canEdit && <button className="text-sm opacity-70 hover:opacity-100" onClick={() => stopRide(x)}>Stop</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        );
      })}
      {!r.isActive && <Badge>This route is closed</Badge>}
    </div>
  );
}
