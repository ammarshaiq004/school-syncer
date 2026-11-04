"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { CircleCheck, Phone, Plus } from "lucide-react";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Dialog,
  DialogClose,
  EmptyState,
  ErrorState,
  NativeSelect,
  Skeleton,
  StatusPill,
  TextField,
  TextareaField,
  useToast,
} from "@/components/ui";
import { platformApi } from "@/lib/api";
import { day, rupees, todayIso } from "@/lib/format";
import { usePlatformApi } from "@/lib/use-api";

type Kind = "CALL" | "VISIT" | "MESSAGE" | "PROMISE_TO_PAY" | "NOTE";

const KINDS: { value: Kind; label: string }[] = [
  { value: "CALL", label: "Phone call" },
  { value: "VISIT", label: "Visit" },
  { value: "MESSAGE", label: "WhatsApp or message" },
  { value: "PROMISE_TO_PAY", label: "Promise to pay" },
  { value: "NOTE", label: "Note" },
];
const kindLabel = (k: Kind) => KINDS.find((x) => x.value === k)?.label ?? k;

export interface Contact {
  id: string;
  kind: Kind;
  note: string;
  promisedAmount: number | null;
  followUpOn: string | null;
  doneAt: string | null;
  adminName: string;
  createdAt: string;
}

/** GET /platform/follow-ups */
export type FollowUp = Contact & { overdue: boolean; school: { id: string; name: string; slug: string } };

async function markDone(id: string) {
  await platformApi(`/contacts/${id}/done`, { method: "POST" });
}

/** The console's contact log for one school: what was said or promised, and when to get back to them. */
export function SchoolContacts({ schoolId }: { schoolId: string }) {
  const toast = useToast();
  const list = usePlatformApi<Contact[]>(`/schools/${schoolId}/contacts`);
  const [adding, setAdding] = useState(false);

  async function done(c: Contact) {
    try {
      await markDone(c.id);
      void list.reload();
    } catch (e) {
      toast.error("Could not mark it done", (e as Error).message);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Contact log"
        description="Calls, visits and promises, with a date to follow up. Only SchoolSyncer staff see this."
        icon={<Phone />}
        action={
          <Button icon={<Plus />} onClick={() => setAdding(true)}>
            Add entry
          </Button>
        }
      />
      {list.error && !list.data ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <Skeleton className="h-32 w-full" />
      ) : list.data.length === 0 ? (
        <EmptyState icon={<Phone />} title="Nothing logged yet" description="Add a call, a visit or a promise to pay so the next person knows." compact />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {list.data.map((c) => (
            <li key={c.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <StatusPill status={c.kind} tone={c.kind === "PROMISE_TO_PAY" ? "warning" : "neutral"} label={kindLabel(c.kind)} />
                  {c.promisedAmount != null && <span className="font-medium text-fg">{rupees(c.promisedAmount)}</span>}
                  <span className="text-fg-muted">
                    {c.adminName}, {day(c.createdAt)}
                  </span>
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-fg">{c.note}</p>
              </div>
              {c.followUpOn && (
                <div className="flex items-center gap-2 text-sm">
                  {c.doneAt ? (
                    <span className="text-fg-muted">Follow-up done</span>
                  ) : (
                    <>
                      <span className="text-fg-secondary">Follow up {day(c.followUpOn)}</span>
                      <Button size="sm" variant="secondary" icon={<CircleCheck />} onClick={() => void done(c)}>
                        Done
                      </Button>
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <AddContactDialog schoolId={schoolId} open={adding} onOpenChange={setAdding} onAdded={list.reload} />
    </Card>
  );
}

function AddContactDialog({ schoolId, open, onOpenChange, onAdded }: { schoolId: string; open: boolean; onOpenChange: (o: boolean) => void; onAdded: () => unknown }) {
  const [kind, setKind] = useState<Kind>("CALL");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const amount = Number(f.get("amount"));
    setBusy(true);
    setError("");
    try {
      await platformApi(`/schools/${schoolId}/contacts`, {
        method: "POST",
        body: {
          kind,
          note: String(f.get("note") ?? "").trim(),
          ...(kind === "PROMISE_TO_PAY" && amount > 0 && { promisedAmount: amount }),
          ...(f.get("followUpOn") && { followUpOn: String(f.get("followUpOn")) }),
        },
      });
      onOpenChange(false);
      setKind("CALL");
      void onAdded();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (busy) return;
        if (!o) setError("");
        onOpenChange(o);
      }}
      title="Add a contact entry"
      description="Say what happened, and pick a date if someone should get back to the school."
    >
      <form onSubmit={submit} className="grid gap-4">
        <NativeSelect aria-label="Kind" options={KINDS} value={kind} onChange={(e) => setKind(e.target.value as Kind)} />
        <TextareaField label="What happened" name="note" required minLength={3} maxLength={1000} rows={3} placeholder="Owner said the fees come in on Friday" />
        {kind === "PROMISE_TO_PAY" && <TextField label="Amount promised (Rs)" name="amount" type="number" min={1} step={1} inputMode="numeric" />}
        <TextField label="Follow up on" name="followUpOn" type="date" min={todayIso()} hint="Optional. It shows under Follow-ups due until marked done." />
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button type="button" variant="secondary" disabled={busy}>
              Cancel
            </Button>
          </DialogClose>
          <Button type="submit" loading={busy}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Open follow-ups across schools (overdue first), for the console overview. */
export function FollowUpsCard() {
  const toast = useToast();
  const list = usePlatformApi<FollowUp[]>("/follow-ups");

  async function done(c: FollowUp) {
    try {
      await markDone(c.id);
      void list.reload();
    } catch (e) {
      toast.error("Could not mark it done", (e as Error).message);
    }
  }

  return (
    <Card>
      <CardHeader title="Follow-ups due" description="Calls and promises to chase, due this week or already late" icon={<Phone />} />
      {list.error && !list.data ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <Skeleton className="h-24 w-full" />
      ) : list.data.length === 0 ? (
        <EmptyState icon={<CircleCheck />} title="Nothing to chase" description="Follow-ups you set on a school's Contacts tab show here." compact />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {list.data.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <Link href={`/platform/schools/${c.school.id}`} className="font-medium text-fg hover:text-brand">
                  {c.school.name}
                </Link>
                <p className="text-fg-secondary">
                  {kindLabel(c.kind)}
                  {c.promisedAmount != null && `, ${rupees(c.promisedAmount)}`}: {c.note}
                </p>
              </div>
              <StatusPill status={c.overdue ? "overdue" : "due"} tone={c.overdue ? "danger" : "info"} label={`${c.overdue ? "Late, " : ""}${day(c.followUpOn!)}`} />
              <Button size="sm" variant="secondary" icon={<CircleCheck />} onClick={() => void done(c)}>
                Done
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
