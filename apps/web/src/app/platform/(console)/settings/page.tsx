"use client";

import { useState, type FormEvent } from "react";
import { Building2, Landmark, Percent } from "lucide-react";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  ErrorState,
  PageHeader,
  Skeleton,
  SkeletonRows,
  Switch,
  TextareaField,
  TextField,
  useToast,
} from "@/components/ui";
import { isOwner, useConsoleAdmin, when } from "@/components/platform/session";
import { platformApi } from "@/lib/api";
import { parseTaxPercent, type PlatformSettings } from "@/lib/platform-billing";
import { usePlatformApi } from "@/lib/use-api";

/** SchoolSyncer's own business details, printed on every bill and receipt. */
export default function SettingsPage() {
  const settings = usePlatformApi<PlatformSettings>("/settings");
  const owner = isOwner(useConsoleAdmin());
  const s = settings.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Settings"
        description="SchoolSyncer's business details and payment instructions, printed on the bills and receipts schools get."
      />
      {!owner && (
        <Alert tone="info" title="View only">
          Only a SchoolSyncer owner can change these details.
        </Alert>
      )}
      {settings.error ? (
        <Card padding="none">
          <ErrorState message={settings.error} onRetry={settings.reload} />
        </Card>
      ) : !s ? (
        <Card className="max-w-3xl" aria-busy="true" aria-label="Loading settings">
          <Skeleton className="h-5 w-48" />
          <SkeletonRows rows={6} columns={2} className="mt-6" />
        </Card>
      ) : (
        <SettingsForm key={s.updatedAt ?? "settings"} settings={s} canEdit={owner} onSaved={settings.reload} />
      )}
    </div>
  );
}

const text = (v: string | null) => v ?? "";
/** Empty boxes are saved as "not set". */
const orNull = (v: string) => v.trim() || null;

function SettingsForm({ settings, canEdit, onSaved }: { settings: PlatformSettings; canEdit: boolean; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [form, setForm] = useState({
    businessName: settings.businessName,
    address: text(settings.address),
    phone: text(settings.phone),
    email: text(settings.email),
    ntn: text(settings.ntn),
    strn: text(settings.strn),
    paymentInstructions: text(settings.paymentInstructions),
  });
  const [taxOn, setTaxOn] = useState(settings.salesTaxPercent !== null);
  const [taxPercent, setTaxPercent] = useState(settings.salesTaxPercent?.toString() ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  const tax = taxOn ? parseTaxPercent(taxPercent) : { value: null };
  const taxError = taxOn && "error" in tax ? tax.error : taxOn && !taxPercent.trim() ? "Enter the percent, or switch tax off." : undefined;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (taxError || "error" in tax) return;
    setError("");
    setSaving(true);
    try {
      await platformApi("/settings", {
        method: "PATCH",
        body: {
          businessName: form.businessName.trim(),
          address: orNull(form.address),
          phone: orNull(form.phone),
          email: orNull(form.email),
          ntn: orNull(form.ntn),
          strn: orNull(form.strn),
          paymentInstructions: orNull(form.paymentInstructions),
          salesTaxPercent: tax.value,
        },
      });
      toast.success("Settings saved", "New bills and receipts use these details.");
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="flex max-w-3xl flex-col gap-6">
      <fieldset disabled={!canEdit} className="contents">
        <Card>
          <CardHeader title="Business details" description="Shown at the top of every bill and receipt." icon={<Building2 />} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Business name" required minLength={2} maxLength={100} value={form.businessName} onChange={set("businessName")} wrapperClassName="sm:col-span-2" />
            <TextareaField label="Address" rows={2} maxLength={300} value={form.address} onChange={set("address")} wrapperClassName="sm:col-span-2" />
            <TextField label="Phone" maxLength={40} value={form.phone} onChange={set("phone")} />
            <TextField label="Email" type="email" maxLength={120} value={form.email} onChange={set("email")} />
            <TextField label="NTN" maxLength={30} value={form.ntn} onChange={set("ntn")} hint="Printed only when filled in." />
            <TextField label="STRN" maxLength={30} value={form.strn} onChange={set("strn")} hint="Sales tax registration number. Printed only when filled in." />
          </div>
        </Card>

        <Card>
          <CardHeader title="Payment instructions" description="How schools should pay: bank account, wallet numbers, what to quote." icon={<Landmark />} />
          <TextareaField
            label="Instructions"
            rows={5}
            maxLength={1000}
            value={form.paymentInstructions}
            onChange={set("paymentInstructions")}
            placeholder={"Bank transfer to SchoolSyncer, Meezan Bank, account 0123-4567890\nJazzCash 0300 1234567\nPlease quote your bill number."}
            hint={`Printed on bills and shown on each school's Plan and billing page. ${form.paymentInstructions.length}/1000 characters.`}
          />
        </Card>

        <Card>
          <CardHeader title="Sales tax on new bills" icon={<Percent />} />
          <div className="flex flex-col gap-4">
            <Switch checked={taxOn} onCheckedChange={setTaxOn} disabled={!canEdit} label={taxOn ? "Sales tax is on" : "Sales tax is off"} />
            {taxOn && (
              <TextField
                label="Tax percent"
                inputMode="numeric"
                value={taxPercent}
                onChange={(e) => setTaxPercent(e.target.value)}
                placeholder="16"
                wrapperClassName="max-w-40"
                error={taxPercent.trim() ? taxError : undefined}
              />
            )}
            <p className="text-[13px] text-fg-muted">
              Only applies to bills issued after you switch it on. Bills already sent keep the tax they were issued with.
              {settings.updatedAt && ` Last changed ${when(settings.updatedAt)}.`}
            </p>
          </div>
        </Card>
      </fieldset>

      {error && <Alert tone="danger">{error}</Alert>}
      {canEdit && (
        <div className="flex justify-end">
          <Button type="submit" loading={saving} disabled={!!taxError}>
            Save settings
          </Button>
        </div>
      )}
    </form>
  );
}
