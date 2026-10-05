"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ArrowRight } from "lucide-react";
import { Alert, Button, Dialog, DialogClose, SelectField, TextField, buttonClass, useToast } from "@/components/ui";
import { platformApi } from "@/lib/api";
import { usePlatformApi } from "@/lib/use-api";
import { TempPassword } from "./temp-password";

interface Created {
  schoolId: string;
  schoolSlug: string;
  owner: { id: string; name: string; email: string };
  temporaryPassword: string;
}

const STATUS_OPTIONS = [
  { value: "TRIAL", label: "Free trial" },
  { value: "ACTIVE", label: "Active (billed from now)" },
];

/** Sets up a school and its owner account from the console. Shows the owner's temporary password once. */
export function CreateSchoolDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: () => void }) {
  const toast = useToast();
  const plans = usePlatformApi<{ plans: { code: string; name: string; isPublic: boolean }[] }>(open ? "/plans" : null);
  const [status, setStatus] = useState("TRIAL");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);

  function change(next: boolean) {
    if (busy) return;
    if (!next) {
      setCreated(null);
      setError("");
      setStatus("TRIAL");
    }
    onOpenChange(next);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const text = (k: string) => String(f.get(k) ?? "").trim() || undefined;
    setBusy(true);
    setError("");
    try {
      const res = await platformApi<Created>("/schools", {
        method: "POST",
        body: {
          schoolName: text("schoolName"),
          city: text("city"),
          ownerName: text("ownerName"),
          email: text("email"),
          phone: text("phone"),
          planCode: text("planCode"),
          status,
          trialDays: status === "TRIAL" && text("trialDays") ? Number(text("trialDays")) : undefined,
        },
      });
      setCreated(res);
      toast.success("School created", `${String(f.get("schoolName"))} can sign in now.`);
      onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const planOptions = (plans.data?.plans ?? []).map((p) => ({ value: p.code, label: p.name }));

  return (
    <Dialog
      open={open}
      onOpenChange={change}
      size="lg"
      title={created ? "School created" : "Add a school"}
      description={created ? `Give these details to ${created.owner.name}.` : "Sets up the school, its main campus and the owner's account."}
    >
      {created ? (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 rounded-lg border border-border bg-surface-2 p-3 text-sm sm:grid-cols-2">
            <div>
              <div className="text-[13px] text-fg-muted">School code</div>
              <div className="font-mono text-fg">{created.schoolSlug}</div>
            </div>
            <div>
              <div className="text-[13px] text-fg-muted">Owner</div>
              <div className="text-fg">{created.owner.name}</div>
            </div>
          </div>
          <TempPassword
            password={created.temporaryPassword}
            login={created.owner.email}
            note="It is shown only once. Pass it on to the owner in person or over the phone. If it gets lost, reset it from the People tab."
          />
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Done
              </Button>
            </DialogClose>
            <Link href={`/platform/schools/${created.schoolId}`} className={buttonClass("primary")} onClick={() => change(false)}>
              Open school
              <ArrowRight aria-hidden />
            </Link>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="School name"
            name="schoolName"
            required
            minLength={2}
            maxLength={120}
            placeholder="Al-Noor Grammar School"
            wrapperClassName="sm:col-span-2"
          />
          <TextField label="City" name="city" maxLength={80} placeholder="Lahore" />
          <TextField label="School phone" name="phone" maxLength={20} placeholder="0300 1234567" />
          <TextField label="Owner's name" name="ownerName" required minLength={2} maxLength={120} placeholder="Ayesha Khan" />
          <TextField label="Owner's email" name="email" type="email" required placeholder="ayesha@school.pk" hint="They sign in with this email." />
          <SelectField
            label="Plan"
            name="planCode"
            required
            options={planOptions}
            placeholder={plans.data ? "Choose a plan" : "Loading plans"}
            defaultValue=""
            error={plans.error ? `Could not load plans: ${plans.error}` : undefined}
          />
          <SelectField label="Start as" name="status" options={STATUS_OPTIONS} value={status} onChange={(e) => setStatus(e.target.value)} />
          {status === "TRIAL" && <TextField label="Trial length (days)" name="trialDays" type="number" min={1} max={365} defaultValue={30} />}
          {error && (
            <Alert tone="danger" className="sm:col-span-2">
              {error}
            </Alert>
          )}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <DialogClose asChild>
              <Button type="button" variant="secondary" disabled={busy}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" loading={busy}>
              Create school
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
