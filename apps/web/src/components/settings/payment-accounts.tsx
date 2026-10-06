"use client";

import { useState, type FormEvent } from "react";
import { Copy, KeyRound } from "lucide-react";
import { PROVIDER_LABEL, type OnlineProvider } from "@/components/invoices/online-payment";
import { Alert, Badge, Button, Card, CardHeader, ErrorState, SkeletonRows, Switch, TextField, useToast, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useApi } from "@/lib/use-api";

/** Shape of GET /school/payment-accounts (apps/api/src/fees/payment-accounts.controller.ts). */
type Source = "school" | "platform" | null;
interface Gateway {
  provider: OnlineProvider;
  source: Source;
  ownAccount: {
    enabled: boolean;
    settings: Record<string, string>;
    secretsSet: Record<string, boolean>;
    missing: string[];
  } | null;
}
interface Accounts {
  mode: "mock" | "sandbox" | "live" | "off";
  canSaveSecrets: boolean;
  problems: string[];
  urls: Record<OnlineProvider, Record<string, string>>;
  gateways: Gateway[];
}

interface FieldSpec {
  key: string;
  label: string;
  secret?: boolean;
  hint?: string;
  optional?: boolean;
}
const FIELDS: Record<OnlineProvider, FieldSpec[]> = {
  JAZZCASH: [
    { key: "merchantId", label: "Merchant ID", hint: "Starts with MC, from the JazzCash merchant portal" },
    { key: "password", label: "Password", secret: true },
    { key: "integritySalt", label: "Integrity salt", secret: true },
  ],
  EASYPAISA: [
    { key: "storeId", label: "Store ID" },
    { key: "username", label: "API username", hint: "For the Inquire Transaction API" },
    { key: "password", label: "API password", secret: true },
    { key: "hashKey", label: "Hash key", secret: true, hint: "16 characters" },
    { key: "accountNum", label: "Account number", optional: true },
  ],
  ONEBILL: [
    { key: "billerPrefix", label: "Biller prefix", hint: "The digits 1LINK gave you; every 1Bill number starts with them" },
    { key: "username", label: "1LINK username" },
    { key: "password", label: "1LINK password", secret: true },
  ],
};
const URL_LABEL: Record<string, string> = {
  returnUrl: "Return URL",
  ipnUrl: "IPN URL",
  postBackUrl: "Post-back URL",
  billInquiryUrl: "Bill inquiry URL",
  billPaymentUrl: "Bill payment URL",
};

function status(g: Gateway): { label: string; tone: Tone } {
  if (g.source === "school") return { label: "Your account", tone: "success" };
  if (g.ownAccount && !g.ownAccount.enabled) return { label: "Switched off", tone: "neutral" };
  if (g.source === "platform") return { label: "SchoolSyncer's account", tone: "info" };
  return { label: g.ownAccount ? "Not finished" : "Not set up", tone: g.ownAccount ? "warning" : "neutral" };
}

/**
 * The school's own JazzCash, Easypaisa and 1Bill merchant accounts. Saved
 * secrets are never shown again; leaving a secret box empty keeps it.
 */
export function PaymentAccounts({ readOnly }: { readOnly: boolean }) {
  const accounts = useApi<Accounts>("/school/payment-accounts");
  const [saved, setSaved] = useState<Accounts | null>(null);
  const data = saved ?? accounts.data;

  if (accounts.error && !data) return <ErrorState message={accounts.error} onRetry={accounts.reload} />;
  if (!data)
    return (
      <Card>
        <SkeletonRows rows={5} columns={2} />
      </Card>
    );

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {data.mode === "mock" && (
        <Alert tone="info" title="Payments are in sandbox mode">
          Parents see a practice checkout and no money moves. Accounts you save here are used once SchoolSyncer switches online
          payments to live.
        </Alert>
      )}
      {data.mode === "off" && <Alert tone="warning" title="Online payments are switched off on this server" />}
      {data.problems.length > 0 && (
        <Alert tone="warning" title="The server is not ready for real payments yet">
          <ul className="list-disc ps-4">
            {data.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Alert>
      )}
      {data.gateways.map((g) => (
        <GatewayCard
          key={`${g.provider}-${JSON.stringify(g.ownAccount)}`}
          gateway={g}
          urls={data.urls[g.provider]}
          readOnly={readOnly || !data.canSaveSecrets}
          onSaved={setSaved}
        />
      ))}
      {!data.canSaveSecrets && !readOnly && (
        <Alert tone="info">Saving merchant accounts needs a PAYMENTS_SECRET_KEY on the server. Ask your SchoolSyncer administrator.</Alert>
      )}
    </div>
  );
}

function GatewayCard({
  gateway: g,
  urls,
  readOnly,
  onSaved,
}: {
  gateway: Gateway;
  urls: Record<string, string>;
  readOnly: boolean;
  onSaved: (a: Accounts) => void;
}) {
  const toast = useToast();
  const [enabled, setEnabled] = useState(g.ownAccount?.enabled ?? true);
  const [values, setValues] = useState<Record<string, string>>(g.ownAccount?.settings ?? {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const s = status(g);
  const label = PROVIDER_LABEL[g.provider];

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const settings: Record<string, string> = {};
    const secrets: Record<string, string> = {};
    for (const f of FIELDS[g.provider]) {
      const v = (values[f.key] ?? "").trim();
      if (f.secret) {
        if (v) secrets[f.key] = v;
      } else settings[f.key] = v;
    }
    try {
      const res = await api<Accounts>(`/school/payment-accounts/${g.provider.toLowerCase()}`, { method: "PUT", body: { enabled, settings, secrets } });
      setError("");
      onSaved(res);
      const after = res.gateways.find((x) => x.provider === g.provider);
      toast.success(`${label} saved`, after?.source === "school" ? "Parents' payments now go to your account." : undefined);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      onSaved(await api<Accounts>(`/school/payment-accounts/${g.provider.toLowerCase()}`, { method: "DELETE" }));
      toast.success(`${label} account removed`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const missing = g.ownAccount?.enabled ? g.ownAccount.missing : [];
  return (
    <Card>
      <CardHeader icon={<KeyRound />} title={label} action={<Badge tone={s.tone}>{s.label}</Badge>} />
      <form onSubmit={save} className="flex flex-col gap-4">
        <Switch checked={enabled} onCheckedChange={setEnabled} disabled={readOnly} label={`Parents can pay with ${label}`} />
        {enabled && (
          <div className="grid gap-4 sm:grid-cols-2">
            {FIELDS[g.provider].map((f) => (
              <TextField
                key={f.key}
                label={f.optional ? `${f.label} (optional)` : f.label}
                type={f.secret ? "password" : "text"}
                autoComplete={f.secret ? "new-password" : "off"}
                value={values[f.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                placeholder={f.secret && g.ownAccount?.secretsSet[f.key] ? "Saved; leave empty to keep" : undefined}
                hint={f.hint}
                disabled={readOnly}
                error={missing.includes(f.key) ? "Still needed" : undefined}
              />
            ))}
          </div>
        )}
        <details className="text-sm">
          <summary className="cursor-pointer font-medium text-fg-secondary">Addresses to give {label}</summary>
          <dl className="mt-2 flex flex-col gap-2">
            {Object.entries(urls).map(([k, url]) => (
              <div key={k} className="flex flex-wrap items-center gap-2">
                <dt className="w-36 text-fg-muted">{URL_LABEL[k] ?? k}</dt>
                <dd className="min-w-0 flex-1 break-all font-mono text-xs text-fg">{url}</dd>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  icon={<Copy />}
                  onClick={() => navigator.clipboard?.writeText(url).then(() => toast.success("Copied"))}
                >
                  Copy
                </Button>
              </div>
            ))}
          </dl>
        </details>
        {error && <Alert tone="danger">{error}</Alert>}
        {!readOnly && (
          <div className="flex flex-wrap justify-end gap-2">
            {g.ownAccount && (
              <Button type="button" variant="ghost" onClick={remove} disabled={busy}>
                Remove my account
              </Button>
            )}
            <Button type="submit" loading={busy}>
              Save {label}
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}
