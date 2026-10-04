"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeftRight, Bus, Plus, Save, UserX } from "lucide-react";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  DataTable,
  DescriptionList,
  Dialog,
  EmptyState,
  ErrorState,
  SelectField,
  SkeletonRows,
  TextField,
  useToast,
  type Column,
} from "@/components/ui";
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

const historyColumns: Column<Ride>[] = [
  { id: "route", header: "Earlier", cell: (h) => h.route },
  { id: "stop", header: "Stop", cell: (h) => h.stop ?? "–", hideBelow: "sm" },
  { id: "from", header: "From", cell: (h) => day(h.startsOn) },
  { id: "to", header: "To", cell: (h) => (h.endsOn ? day(h.endsOn) : "–") },
];

/** A student's school van: where they're picked up, and changing or stopping it. */
export function StudentTransport({ studentId, active }: { studentId: string; active: boolean }) {
  const user = useSession();
  const toast = useToast();
  const canEdit = hasRole(user, SETUP) && active;
  const rides = useApi<{ current: Ride | null; history: Ride[] }>(`/transport/students/${studentId}`);
  const routes = useApi<Route[]>(canEdit ? "/transport/routes" : null);
  const [editing, setEditing] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [routeId, setRouteId] = useState("");
  const [stopId, setStopId] = useState("");
  const [startsOn, setStartsOn] = useState(todayIso());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const current = rides.data?.current;
  const openRoutes = routes.data?.filter((r) => r.isActive) ?? [];
  const route = openRoutes.find((r) => r.id === routeId);

  function startEdit() {
    setRouteId(current?.routeId ?? openRoutes[0]?.id ?? "");
    setStopId(current?.stopId ?? "");
    setStartsOn(todayIso());
    setError("");
    setEditing(true);
  }

  async function save() {
    setError("");
    setBusy(true);
    try {
      await api("/transport/assignments", { method: "POST", body: { studentId, routeId, stopId: stopId || null, startsOn } });
      setEditing(false);
      toast.success(current ? "Transport changed" : "Added to the route");
      await rides.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!current) return;
    setBusy(true);
    try {
      await api(`/transport/assignments/${current.id}/end`, { method: "POST", body: {} });
      setConfirmStop(false);
      toast.success("Transport stopped");
      await rides.reload();
    } catch (e) {
      toast.error("Could not stop transport", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Transport"
        icon={<Bus />}
        action={
          canEdit &&
          rides.data && (
            <>
              <Button type="button" size="sm" variant="secondary" icon={current ? <ArrowLeftRight /> : <Plus />} onClick={startEdit}>
                {current ? "Change" : "Add to a route"}
              </Button>
              {current && (
                <Button type="button" size="sm" variant="ghost" icon={<UserX />} onClick={() => setConfirmStop(true)}>Stop</Button>
              )}
            </>
          )
        }
      />
      {rides.error ? (
        <ErrorState compact message={rides.error} onRetry={rides.reload} />
      ) : !rides.data ? (
        <SkeletonRows rows={3} columns={2} />
      ) : current ? (
        <DescriptionList
          items={[
            { label: "Route", value: <Link className="text-brand hover:underline" href={`/transport/routes/${current.routeId}`}>{current.route}</Link> },
            { label: "Stop", value: current.stop ? stopLabel({ ...current, name: current.stop }) : "No set stop" },
            { label: "Fee", value: `${rupees(current.fee)} a month` },
            { label: "Since", value: day(current.startsOn) },
            ...(current.vehicle
              ? [
                  { label: "Van", value: current.vehicle.registrationNo },
                  { label: "Driver", value: <>{current.vehicle.driverName}, <a className="text-brand hover:underline" href={`tel:${current.vehicle.driverPhone}`}>{current.vehicle.driverPhone}</a></> },
                ]
              : []),
          ]}
        />
      ) : (
        <EmptyState compact icon={<Bus />} title="Doesn't use school transport" description={canEdit ? "Add them to a route to start pick-up and drop." : undefined} />
      )}
      {rides.data && rides.data.history.length > 0 && (
        <div className="mt-5 overflow-hidden rounded-lg border border-border">
          <DataTable bare dense label="Earlier transport" columns={historyColumns} data={rides.data.history} getRowId={(h) => h.id} pageSize={0} />
        </div>
      )}

      {canEdit && (
        <Dialog
          open={editing}
          onOpenChange={setEditing}
          title={current ? "Change transport" : "Add to a route"}
          description="The old route, if any, ends the day before the new one starts."
          footer={
            <>
              <Button type="button" variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
              <Button type="button" icon={<Save />} onClick={save} loading={busy} disabled={!routeId}>Save</Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            {error && <Alert tone="danger">{error}</Alert>}
            {routes.error && <ErrorState compact message={routes.error} onRetry={routes.reload} />}
            {routes.data && openRoutes.length === 0 && <Alert tone="warning">There are no open routes. Add one on the Transport page first.</Alert>}
            <SelectField
              label="Route"
              value={routeId}
              onChange={(e) => {
                setRouteId(e.target.value);
                setStopId("");
              }}
              options={openRoutes.map((r) => ({
                value: r.id,
                label: `${r.name} · ${r.vehicle ? `${r.riders}/${r.vehicle.capacity} seats` : `${r.riders} riders`}`,
              }))}
            />
            <SelectField
              label="Stop"
              value={stopId}
              onChange={(e) => setStopId(e.target.value)}
              options={[
                { value: "", label: "No set stop" },
                ...(route?.stops.map((s) => ({ value: s.id, label: `${stopLabel(s)} · ${rupees(s.monthlyFee ?? route.monthlyFee)}` })) ?? []),
              ]}
            />
            <TextField label="From" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
          </div>
        </Dialog>
      )}

      <ConfirmDialog
        open={confirmStop}
        onOpenChange={setConfirmStop}
        title="Stop transport from today?"
        description={current ? `${current.route} is still charged for this month.` : undefined}
        confirmLabel="Stop transport"
        destructive
        loading={busy}
        onConfirm={stop}
      />
    </Card>
  );
}
