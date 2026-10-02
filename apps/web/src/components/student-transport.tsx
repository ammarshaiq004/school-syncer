"use client";

import { useState } from "react";
import { Button, Card, ErrorText, rowClass, tableClass } from "@/components/ui";
import { api } from "@/lib/api";
import { day, rupees, todayIso } from "@/lib/format";
import { hasRole, SETUP, useSession } from "@/lib/session";
import { stopLabel, type Route } from "@/lib/transport";
import { useApi } from "@/lib/use-api";

interface Ride {
  id: string;
  routeId: string;
  route: string;
  stopId: string | null;
  stop: string | null;
  pickupTime: string | null;
  dropTime: string | null;
  fee: number;
  vehicle: { registrationNo: string; driverName: string; driverPhone: string } | null;
  startsOn: string;
  endsOn: string | null;
}

const selectClass = "rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20";

/** A student's school van: where they're picked up, and changing or stopping it. */
export function StudentTransport({ studentId, active }: { studentId: string; active: boolean }) {
  const user = useSession();
  const canEdit = hasRole(user, SETUP) && active;
  const rides = useApi<{ current: Ride | null; history: Ride[] }>(`/transport/students/${studentId}`);
  const routes = useApi<Route[]>(canEdit ? "/transport/routes" : null);
  const [editing, setEditing] = useState(false);
  const [routeId, setRouteId] = useState("");
  const [stopId, setStopId] = useState("");
  const [startsOn, setStartsOn] = useState(todayIso());
  const [error, setError] = useState("");

  const current = rides.data?.current;
  const openRoutes = routes.data?.filter((r) => r.isActive) ?? [];
  const route = openRoutes.find((r) => r.id === routeId);

  function startEdit() {
    setRouteId(current?.routeId ?? openRoutes[0]?.id ?? "");
    setStopId(current?.stopId ?? "");
    setStartsOn(todayIso());
    setEditing(true);
  }

  async function save() {
    setError("");
    try {
      await api("/transport/assignments", { method: "POST", body: { studentId, routeId, stopId: stopId || null, startsOn } });
      setEditing(false);
      await rides.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function stop() {
    if (!current || !confirm(`Stop transport from today? ${current.route} is still charged for this month.`)) return;
    setError("");
    try {
      await api(`/transport/assignments/${current.id}/end`, { method: "POST", body: {} });
      await rides.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-semibold">Transport</h2>
        {canEdit && !editing && (
          <div className="flex gap-3 text-sm">
            <button className="text-brand" onClick={startEdit}>{current ? "Change" : "Add to a route"}</button>
            {current && <button className="opacity-70 hover:opacity-100" onClick={stop}>Stop</button>}
          </div>
        )}
      </div>
      <ErrorText>{rides.error || error}</ErrorText>
      {editing ? (
        <div className="flex flex-col gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="font-medium">Route</span>
            <select className={selectClass} value={routeId} onChange={(e) => (setRouteId(e.target.value), setStopId(""))}>
              {openRoutes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} · {r.vehicle ? `${r.riders}/${r.vehicle.capacity} seats` : `${r.riders} riders`}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium">Stop</span>
            <select className={selectClass} value={stopId} onChange={(e) => setStopId(e.target.value)}>
              <option value="">No set stop</option>
              {route?.stops.map((s) => (
                <option key={s.id} value={s.id}>{stopLabel(s)} · {rupees(s.monthlyFee ?? route.monthlyFee)}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium">From</span>
            <input type="date" className={selectClass} value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
          </label>
          <div className="flex gap-2">
            <Button onClick={save} disabled={!routeId}>Save</Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      ) : current ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="opacity-60">Route</dt><dd>{current.route}</dd>
          <dt className="opacity-60">Stop</dt><dd>{current.stop ? stopLabel({ ...current, name: current.stop }) : "No set stop"}</dd>
          <dt className="opacity-60">Fee</dt><dd>{rupees(current.fee)} a month</dd>
          {current.vehicle && (
            <>
              <dt className="opacity-60">Van</dt><dd>{current.vehicle.registrationNo}</dd>
              <dt className="opacity-60">Driver</dt>
              <dd>{current.vehicle.driverName}, <a className="text-brand" href={`tel:${current.vehicle.driverPhone}`}>{current.vehicle.driverPhone}</a></dd>
            </>
          )}
          <dt className="opacity-60">Since</dt><dd>{day(current.startsOn)}</dd>
        </dl>
      ) : (
        <p className="text-sm opacity-60">Doesn&apos;t use school transport.</p>
      )}
      {!editing && (rides.data?.history.length ?? 0) > 0 && (
        <table className={`${tableClass} mt-4`}>
          <thead className="opacity-60"><tr><th className="py-2">Earlier</th><th>Stop</th><th>From</th><th>To</th></tr></thead>
          <tbody>
            {rides.data!.history.map((h) => (
              <tr key={h.id} className={rowClass}>
                <td className="py-2">{h.route}</td>
                <td>{h.stop ?? "–"}</td>
                <td>{day(h.startsOn)}</td>
                <td>{h.endsOn ? day(h.endsOn) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
