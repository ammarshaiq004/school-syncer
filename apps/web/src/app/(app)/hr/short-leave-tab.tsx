"use client";

import { useState, type FormEvent } from "react";
import { Check, Clock, Send, X } from "lucide-react";
import { Alert, Avatar, Button, Card, CardHeader, DataTable, Field, Section, StatusPill, TextArea, useToast, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { day, todayIso } from "@/lib/format";
import { hasRole, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

interface ShortLeave {
  id: string;
  userId: string;
  date: string;
  fromTime: string;
  toTime: string;
  reason: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  user: { name: string };
}

/** A few hours off within one day. Approved ones count against the school's free short leaves each month. */
export function ShortLeaveTab({ isAdmin }: { isAdmin: boolean }) {
  const user = useSession();
  const toast = useToast();
  const list = useApi<ShortLeave[]>("/hr/short-leave");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);

  async function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const f = new FormData(form);
    setSending(true);
    try {
      await api("/hr/short-leave", {
        method: "POST",
        body: { date: f.get("date"), fromTime: f.get("fromTime"), toTime: f.get("toTime"), reason: f.get("reason") || undefined },
      });
      form.reset();
      setError("");
      toast.success("Short leave request sent.");
      await list.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function decide(l: ShortLeave, approve: boolean) {
    setDeciding(l.id);
    try {
      await api(`/hr/short-leave/${l.id}/decide`, { method: "POST", body: { approve } });
      toast.success(approve ? "Short leave approved" : "Short leave rejected", l.user.name);
      await list.reload();
    } catch (e) {
      toast.error("Could not save the decision", (e as Error).message);
    } finally {
      setDeciding(null);
    }
  }

  const canDecide = (l: ShortLeave) => isAdmin && l.status === "PENDING" && (l.userId !== user.sub || hasRole(user, ["OWNER"]));
  const columns: Column<ShortLeave>[] = [
    ...(isAdmin
      ? [
          {
            id: "who",
            header: "Staff",
            sortValue: (l: ShortLeave) => l.user.name,
            cell: (l: ShortLeave) => (
              <span className="flex items-center gap-2.5">
                <Avatar name={l.user.name} size="xs" />
                <span className="font-medium">{l.user.name}</span>
              </span>
            ),
          },
        ]
      : []),
    {
      id: "when",
      header: "When",
      sortValue: (l) => l.date,
      cell: (l) => (
        <span className="block">
          {day(l.date)}, {l.fromTime} to {l.toTime}
          {l.reason && <span className="block max-w-[32ch] truncate text-xs text-fg-muted" title={l.reason}>{l.reason}</span>}
        </span>
      ),
    },
    { id: "status", header: "Status", sortValue: (l) => l.status, cell: (l) => <StatusPill status={l.status} /> },
    ...(isAdmin
      ? [
          {
            id: "actions",
            header: <span className="sr-only">Actions</span>,
            align: "right" as const,
            cell: (l: ShortLeave) =>
              canDecide(l) ? (
                <span className="inline-flex gap-1.5">
                  <Button type="button" size="sm" variant="secondary" icon={<Check />} loading={deciding === l.id} onClick={() => decide(l, true)} aria-label={`Approve short leave for ${l.user.name}`}>
                    Approve
                  </Button>
                  <Button type="button" size="sm" variant="ghost" icon={<X />} disabled={deciding === l.id} onClick={() => decide(l, false)} aria-label={`Reject short leave for ${l.user.name}`}>
                    Reject
                  </Button>
                </span>
              ) : null,
          },
        ]
      : []),
  ];

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[2fr_1fr]">
      <Section title={isAdmin ? "Short leave requests" : "My short leaves"}>
        <DataTable
          label="Short leaves"
          columns={columns}
          data={list.data}
          error={list.error}
          onRetry={list.reload}
          getRowId={(l) => l.id}
          pageSize={10}
          empty={{ title: "No short leaves yet", description: isAdmin ? "Requests from staff appear here for a decision." : "Ask for a few hours off using the form.", icon: <Clock /> }}
        />
      </Section>
      <Card>
        <CardHeader title="Ask for a short leave" icon={<Send />} description="A few hours within one working day." />
        <form className="flex flex-col gap-4" onSubmit={apply}>
          <Field label="Date" name="date" type="date" required defaultValue={todayIso()} />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <Field label="From" name="fromTime" type="time" required defaultValue="11:00" />
            <Field label="To" name="toTime" type="time" required defaultValue="13:00" />
          </div>
          <TextArea label="Reason (optional)" name="reason" rows={2} />
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="flex justify-end">
            <Button type="submit" icon={<Send />} loading={sending}>Send request</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
