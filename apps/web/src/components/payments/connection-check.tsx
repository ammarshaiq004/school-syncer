"use client";

import { useState } from "react";
import { CircleCheck, CircleX, PlugZap } from "lucide-react";
import { PROVIDER_LABEL, type OnlineProvider } from "@/components/invoices/online-payment";
import { Alert, Button } from "@/components/ui";

/** Shape of POST .../:provider/check (apps/api/src/fees/gateway-checks.service.ts). */
export interface ConnectionCheck {
  provider: OnlineProvider;
  account: "school" | "platform";
  mode: "mock" | "sandbox" | "live" | "off";
  ok: boolean;
  simulated: boolean;
  /** The gateway's own code, or "HTTP 401", "TIMEOUT" and the like. */
  code: string | null;
  message: string | null;
  hint: string;
  steps: { label: string; ok: boolean; detail?: string }[];
  ms: number;
  checkedAt: string;
  /** 1Bill: what to give 1LINK (no password). */
  setup?: Record<string, string>;
}

const SETUP_LABEL: Record<string, string> = {
  billInquiryUrl: "Bill inquiry URL",
  billPaymentUrl: "Bill payment URL",
  billerPrefix: "Biller prefix",
  username: "Username",
};

/**
 * "Test connection": one harmless call to the gateway (no money moves) and
 * its pass or fail. `run` calls the school's or the console's check endpoint.
 */
export function ConnectionCheckButton({ provider, run }: { provider: OnlineProvider; run: () => Promise<ConnectionCheck> }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ConnectionCheck | null>(null);
  const [error, setError] = useState("");

  async function check() {
    setBusy(true);
    setError("");
    try {
      setResult(await run());
    } catch (e) {
      setResult(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button type="button" variant="secondary" icon={<PlugZap />} loading={busy} onClick={check}>
          Test connection
        </Button>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {result && <ConnectionCheckResult result={result} label={PROVIDER_LABEL[provider]} />}
    </div>
  );
}

export function ConnectionCheckResult({ result: r, label }: { result: ConnectionCheck; label: string }) {
  const title = r.simulated
    ? `${label}: simulated pass`
    : r.ok
      ? `${label} connection works`
      : `${label} connection failed${r.code ? ` (${r.code})` : ""}`;
  return (
    <Alert tone={r.ok ? (r.simulated ? "info" : "success") : "danger"} title={title}>
      <div className="flex flex-col gap-2">
        <p>{r.hint}</p>
        {r.message && (
          <p className="text-xs">
            {label} said: <span className="font-mono">{r.message}</span>
          </p>
        )}
        <ul className="flex flex-col gap-1" aria-label="Check steps">
          {r.steps.map((s) => (
            <li key={s.label} className="flex items-start gap-2">
              {s.ok ? <CircleCheck className="mt-0.5 size-4 shrink-0" aria-label="Passed" /> : <CircleX className="mt-0.5 size-4 shrink-0" aria-label="Failed" />}
              <span>
                {s.label}
                {s.detail && <span className="text-xs opacity-80"> ({s.detail})</span>}
              </span>
            </li>
          ))}
        </ul>
        {r.setup && (
          <dl className="flex flex-col gap-1 text-xs">
            <dt className="font-medium">Give 1LINK these (and the password you saved):</dt>
            {Object.entries(r.setup).map(([k, v]) => (
              <dd key={k} className="break-all">
                {SETUP_LABEL[k] ?? k}: <span className="font-mono">{v}</span>
              </dd>
            ))}
          </dl>
        )}
        <p className="text-xs opacity-80">
          {r.mode} mode, {r.account === "school" ? "your own account" : "the server's account"}, {r.ms} ms
        </p>
      </div>
    </Alert>
  );
}
