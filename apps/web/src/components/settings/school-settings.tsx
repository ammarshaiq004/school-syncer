"use client";

import { useState, type FormEvent } from "react";
import { Building, CalendarDays, Wallet } from "lucide-react";
import { Alert, Avatar, Button, Card, CardHeader, DescriptionList, SelectField, TextField, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { rupees } from "@/lib/format";

export interface School {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  locale: string;
  currency: string;
  lateFeePerDay: number;
  feeDueDay: number;
  _count?: { campuses: number; users: number };
}

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/** Fields the school may leave blank; clearing one sends null. */
const CLEARABLE = new Set(["city", "phone", "email", "logoUrl"]);

/** Only the fields that changed. A blank clearable field that had a value is sent as null; other blanks are skipped. */
function changes(school: School, next: Record<string, string | number>) {
  const current = school as unknown as Record<string, unknown>;
  const out: Record<string, string | number | null> = {};
  for (const [k, v] of Object.entries(next)) {
    if (v === "") {
      if (CLEARABLE.has(k) && current[k]) out[k] = null;
      continue;
    }
    if (v === current[k]) continue;
    out[k] = v;
  }
  return out;
}

export function SchoolProfileForm({ school, readOnly, onSaved }: { school: School; readOnly: boolean; onSaved: (s: School) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [logo, setLogo] = useState(school.logoUrl ?? "");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const body = changes(school, {
      name: String(f.get("name") ?? "").trim(),
      city: String(f.get("city") ?? "").trim(),
      phone: String(f.get("phone") ?? "").trim(),
      email: String(f.get("email") ?? "").trim(),
      logoUrl: String(f.get("logoUrl") ?? "").trim(),
      locale: String(f.get("locale") ?? ""),
    });
    if (Object.keys(body).length === 0) return toast.info("Nothing to save", "The school profile is unchanged.");
    setBusy(true);
    setError("");
    try {
      const saved = await api<School>("/school", { method: "PATCH", body });
      onSaved(saved);
      toast.success("School profile saved");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader icon={<Building />} title="School profile" description="Shown on fee vouchers, report cards, certificates and messages to parents." />
      <form onSubmit={submit} className="flex flex-col gap-4">
        <fieldset disabled={readOnly} className="grid gap-4 sm:grid-cols-2">
          <TextField label="School name" name="name" required minLength={2} maxLength={120} defaultValue={school.name} wrapperClassName="sm:col-span-2" />
          <TextField label="City" name="city" maxLength={80} defaultValue={school.city ?? ""} placeholder="Lahore" />
          <TextField label="Phone" name="phone" maxLength={20} inputMode="tel" defaultValue={school.phone ?? ""} placeholder="042 35761234" />
          <TextField label="Email" name="email" type="email" defaultValue={school.email ?? ""} placeholder="office@school.pk" />
          <SelectField
            label="Language"
            name="locale"
            defaultValue={school.locale}
            options={[
              { value: "en", label: "English" },
              { value: "ur", label: "Urdu" },
            ]}
            hint="For messages to parents"
          />
          <div className="flex items-end gap-3 sm:col-span-2">
            <Avatar name={school.name} src={logo || null} size="lg" />
            <TextField
              label="Logo URL"
              name="logoUrl"
              type="url"
              defaultValue={school.logoUrl ?? ""}
              onChange={(e) => setLogo(e.target.value)}
              placeholder="https://example.pk/logo.png"
              hint="A square PNG or JPG works best"
              wrapperClassName="flex-1"
            />
          </div>
        </fieldset>
        <DescriptionList
          columns={3}
          className="rounded-lg bg-surface-2 p-4"
          items={[
            { label: "School code", value: <code className="font-mono text-[13px]">{school.slug}</code> },
            { label: "Currency", value: school.currency },
            { label: "Campuses", value: school._count?.campuses ?? "Not available" },
          ]}
        />
        {error && <Alert tone="danger">{error}</Alert>}
        {!readOnly && (
          <div className="flex justify-end">
            <Button type="submit" loading={busy}>
              Save profile
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}

export function FeeSettingsForm({ school, readOnly, onSaved }: { school: School; readOnly: boolean; onSaved: (s: School) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lateFee, setLateFee] = useState(String(school.lateFeePerDay));
  const [dueDay, setDueDay] = useState(String(school.feeDueDay));
  const due = Math.min(31, Math.max(1, Number(dueDay) || 1));
  const fine = Math.max(0, Number(lateFee) || 0);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const saved = await api<School>("/school", { method: "PATCH", body: { lateFeePerDay: fine, feeDueDay: due } });
      onSaved(saved);
      toast.success("Fee settings saved");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader icon={<Wallet />} title="Fee rules" description="Used when monthly invoices are generated and when late fines are worked out." />
      <form onSubmit={submit} className="flex flex-col gap-4">
        <fieldset disabled={readOnly} className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Due day of the month"
            name="feeDueDay"
            type="number"
            min={1}
            max={31}
            required
            value={dueDay}
            onChange={(e) => setDueDay(e.target.value)}
            hint="In shorter months the last day is used instead"
          />
          <TextField
            label="Late fee per day (PKR)"
            name="lateFeePerDay"
            type="number"
            min={0}
            max={100000}
            step={1}
            required
            value={lateFee}
            onChange={(e) => setLateFee(e.target.value)}
            hint="Set to 0 for no late fee"
          />
        </fieldset>
        <Alert tone="info" icon={<CalendarDays />}>
          Monthly fees fall due on the {ordinal(due)} of each month.{" "}
          {fine > 0 ? `A voucher paid 10 days late adds ${rupees(fine * 10)} in late fees.` : "No late fee is added to overdue vouchers."}
        </Alert>
        {error && <Alert tone="danger">{error}</Alert>}
        {!readOnly && (
          <div className="flex justify-end">
            <Button type="submit" loading={busy}>
              Save fee rules
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}
