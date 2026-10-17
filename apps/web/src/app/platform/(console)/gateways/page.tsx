"use client";

import { useEffect, useState, type FormEvent } from "react";
import { FlaskConical, KeyRound, RefreshCw, Undo2, X } from "lucide-react";
import {
  CHECKOUT_LABEL,
  groupDigits,
  postToGateway,
  PROVIDER_LABEL,
  type CheckoutAction,
  type CheckoutStatus,
  type OnlineProvider,
} from "@/components/invoices/online-payment";
import { ConnectionCheckButton, type ConnectionCheck } from "@/components/payments/connection-check";
import { when } from "@/components/platform/session";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  DataTable,
  DescriptionList,
  Drawer,
  ErrorState,
  PageHeader,
  SelectField,
  SkeletonRows,
  TextField,
  useToast,
  type Column,
  type Tone,
} from "@/components/ui";
import { platformApi } from "@/lib/api";
import { rupees } from "@/lib/format";
import { usePlatformApi } from "@/lib/use-api";

/** Shapes of /platform/gateways (apps/api/src/platform/platform-gateways.controller.ts). */
type Mode = "mock" | "sandbox" | "live" | "off";
interface Overview {
  mode: Mode;
  problems: string[];
  testAmount: { default: number; max: number };
  gateways: {
    provider: OnlineProvider;
    configured: boolean;
    missing: string[];
    account: Record<string, string>;
    urls: Record<string, string>;
  }[];
}

type RunStatus = "WAITING" | "EXPIRED" | "PAID" | "REVIEW" | "FAILED" | "REVERSED" | "CANCELLED";
interface Run {
  id: string;
  school: { id: string; name: string };
  provider: OnlineProvider;
  mode: Mode;
  account: "school" | "platform";
  amount: number;
  status: RunStatus;
  outcome: string | null;
  startedBy: string | null;
  checkout: {
    id: string;
    status: CheckoutStatus;
    txnRef: string;
    consumerNumber: string | null;
    providerRef: string | null;
    responseCode: string | null;
    message: string | null;
    expiresAt: string;
  } | null;
  receipt: { receiptNo: string; receivedAt: string; reversed: boolean } | null;
  callbackSeen: boolean;
  events: { at: string; kind: string; verified: boolean; status: CheckoutStatus | null; code: string | null }[];
  timings: {
    startedAt: string;
    callbackAt: string | null;
    paidAt: string | null;
    reversedAt: string | null;
    finishedAt: string | null;
    toCallback: number | null;
    toPaid: number | null;
  };
}

const RUN_STATUS: Record<RunStatus, { label: string; tone: Tone }> = {
  WAITING: { label: "Waiting for payment", tone: "warning" },
  EXPIRED: { label: "Expired unpaid", tone: "neutral" },
  PAID: { label: "Paid, not reversed yet", tone: "info" },
  REVIEW: { label: "Needs review", tone: "warning" },
  FAILED: { label: "Not completed", tone: "danger" },
  REVERSED: { label: "Passed and reversed", tone: "success" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

const CALL_LABEL: Record<string, string> = {
  return: "Browser return",
  ipn: "IPN",
  "1link-inquiry": "1LINK bill inquiry",
  "1link-payment": "1LINK bill payment",
  "status-inquiry": "Our status inquiry",
  mock: "Simulated gateway",
};

const URL_LABEL: Record<string, string> = {
  returnUrl: "Return URL",
  ipnUrl: "IPN URL",
  postBackUrl: "Post-back URL",
  billInquiryUrl: "Bill inquiry URL",
  billPaymentUrl: "Bill payment URL",
};

const ACCOUNT_LABEL: Record<string, string> = {
  merchantId: "Merchant ID",
  storeId: "Store ID",
  username: "Username",
  accountNum: "Account number",
  billerPrefix: "Biller prefix",
};

const secs = (n: number | null) => (n === null ? "Not yet" : n < 120 ? `${n} s` : `${Math.round(n / 60)} min`);
const isOpen = (r: Run) => !r.timings.finishedAt;

const columns: Column<Run>[] = [
  { id: "when", header: "Started", cell: (r) => <span className="whitespace-nowrap tabular-nums text-fg-secondary">{when(r.timings.startedAt)}</span> },
  { id: "gateway", header: "Gateway", cell: (r) => `${PROVIDER_LABEL[r.provider]} (${r.mode})` },
  { id: "school", header: "School", cell: (r) => r.school.name, hideBelow: "md" },
  { id: "amount", header: "Amount", cell: (r) => rupees(r.amount), align: "right", hideBelow: "sm" },
  { id: "callback", header: "Callback", cell: (r) => (r.callbackSeen ? `Seen after ${secs(r.timings.toCallback)}` : "Not seen"), hideBelow: "lg" },
  { id: "status", header: "Result", cell: (r) => <Badge tone={RUN_STATUS[r.status].tone}>{RUN_STATUS[r.status].label}</Badge> },
];

/**
 * The server's gateway accounts and the guided small live test (SCHOOL-149):
 * test each account's credentials, pay a token voucher through the real
 * gateway, watch the callbacks arrive, then reverse it.
 */
export default function PlatformGatewaysPage() {
  const overview = usePlatformApi<Overview>("/gateways");
  const runs = usePlatformApi<Run[]>("/gateways/runs");
  // The gateway sends staff back here with ?run=... after paying.
  const [openId, setOpenId] = useState<string | null>(() => new URLSearchParams(window.location.search).get("run"));

  if (overview.error && !overview.data) return <ErrorState message={overview.error} onRetry={overview.reload} />;
  const data = overview.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Payment gateways"
        description="Test the server's JazzCash, Easypaisa and 1Bill accounts, and run a small real payment that is reversed afterwards. See docs/gateway-go-live.md."
        meta={data && <Badge tone={data.mode === "live" ? "danger" : data.mode === "sandbox" ? "warning" : "neutral"}>{data.mode} mode</Badge>}
      />
      {!data ? (
        <Card>
          <SkeletonRows rows={4} columns={2} />
        </Card>
      ) : (
        <>
          {data.problems.length > 0 && (
            <Alert tone="warning" title="Not ready for real payments yet">
              <ul className="list-disc ps-4">
                {data.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </Alert>
          )}
          <div className="grid gap-4 lg:grid-cols-3">
            {data.gateways.map((g) => (
              <Card key={g.provider}>
                <CardHeader
                  icon={<KeyRound />}
                  title={PROVIDER_LABEL[g.provider]}
                  action={<Badge tone={g.configured ? "success" : "neutral"}>{g.configured ? "Server account set" : "No server account"}</Badge>}
                />
                <div className="flex flex-col gap-3 text-sm">
                  {g.missing.length > 0 && <p className="text-fg-secondary">Set {g.missing.join(", ")} on the server.</p>}
                  <dl className="flex flex-col gap-1">
                    {Object.entries(g.account)
                      .filter(([, v]) => v)
                      .map(([k, v]) => (
                        <div key={k} className="flex gap-2">
                          <dt className="w-32 text-fg-muted">{ACCOUNT_LABEL[k] ?? k}</dt>
                          <dd className="font-mono text-xs">{v}</dd>
                        </div>
                      ))}
                  </dl>
                  <details>
                    <summary className="cursor-pointer font-medium text-fg-secondary">Addresses to register</summary>
                    <dl className="mt-2 flex flex-col gap-1.5">
                      {Object.entries(g.urls).map(([k, url]) => (
                        <div key={k}>
                          <dt className="text-fg-muted">{URL_LABEL[k] ?? k}</dt>
                          <dd className="break-all font-mono text-xs">{url}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                  {data.mode !== "off" && (
                    <ConnectionCheckButton
                      provider={g.provider}
                      run={() => platformApi<ConnectionCheck>(`/gateways/${g.provider.toLowerCase()}/check`, { method: "POST" })}
                    />
                  )}
                </div>
              </Card>
            ))}
          </div>
          {data.mode !== "off" && (
            <StartTest
              overview={data}
              onStarted={(run) => {
                runs.reload();
                setOpenId(run.id);
              }}
            />
          )}
        </>
      )}

      <DataTable
        label="Gateway test runs"
        columns={columns}
        data={runs.data}
        getRowId={(r) => r.id}
        error={runs.error}
        onRetry={runs.reload}
        empty={{ icon: <FlaskConical />, title: "No test runs yet", description: "Each small live test shows here with its result and timings." }}
        onRowClick={(r) => setOpenId(r.id)}
        getRowLabel={(r) => `Test run ${PROVIDER_LABEL[r.provider]} for ${r.school.name}`}
      />

      <RunDrawer key={openId ?? ""} id={openId} onClose={() => setOpenId(null)} onChanged={runs.reload} />
    </div>
  );
}

function StartTest({ overview, onStarted }: { overview: Overview; onStarted: (run: Run) => void }) {
  const toast = useToast();
  const schools = usePlatformApi<{ id: string; name: string }[]>("/schools");
  const [schoolId, setSchoolId] = useState("");
  const [provider, setProvider] = useState<OnlineProvider>("JAZZCASH");
  const [amount, setAmount] = useState(String(overview.testAmount.default));
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const live = overview.mode === "live";

  async function start(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { run, action } = await platformApi<{ run: Run; action: CheckoutAction }>("/gateways/runs", {
        method: "POST",
        body: { schoolId, provider, amount: Number(amount) },
      });
      onStarted(run);
      if (action.kind === "form") {
        // Leaves for the gateway's page; it sends staff back here with ?run=.
        toast.success("Test voucher made", `Opening ${PROVIDER_LABEL[provider]}'s checkout`);
        postToGateway(action);
        return;
      }
      toast.success("Test voucher made", action.kind === "onebill" ? "Pay the 1Bill number from a banking app" : "Use Simulate to play the gateway");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        icon={<FlaskConical />}
        title="Small live test"
        description={`Makes a test voucher for the school's "Gateway Test" student, pays it through the gateway, then reverses it so the school's totals are unchanged. At most ${rupees(overview.testAmount.max)}.`}
      />
      <form onSubmit={start} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <SelectField
            label="School"
            required
            placeholder="Choose a school"
            options={(schools.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
            value={schoolId}
            onChange={(e) => setSchoolId(e.target.value)}
            hint="Its own account is used if it has one, else the server's"
          />
          <SelectField
            label="Gateway"
            options={overview.gateways.map((g) => ({ value: g.provider, label: PROVIDER_LABEL[g.provider] }))}
            value={provider}
            onChange={(e) => setProvider(e.target.value as OnlineProvider)}
          />
          <TextField
            label="Amount (Rs)"
            type="number"
            min={1}
            max={overview.testAmount.max}
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        {live && (
          <Checkbox
            checked={understood}
            onCheckedChange={setUnderstood}
            label={`This is live mode: ${rupees(Number(amount) || 0)} of real money will be paid. I will reverse it here and refund it with the gateway if needed.`}
          />
        )}
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex justify-end">
          <Button type="submit" loading={busy} disabled={!schoolId || (live && !understood)}>
            Start test payment
          </Button>
        </div>
      </form>
    </Card>
  );
}

function RunDrawer({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const fetched = usePlatformApi<Run>(id ? `/gateways/runs/${id}` : null);
  const [busy, setBusy] = useState<string | null>(null);
  const { data: run, error, reload: load } = fetched;

  // Callbacks arrive on their own: watch for them while the test is open.
  const waiting = run?.status === "WAITING";
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [waiting, load]);

  async function act(name: "refresh" | "simulate" | "reverse" | "cancel", body?: unknown, done?: string) {
    if (!id) return;
    setBusy(name + JSON.stringify(body ?? ""));
    try {
      await platformApi<Run>(`/gateways/runs/${id}/${name}`, { method: "POST", body });
      await load();
      onChanged();
      if (done) toast.success(done);
    } catch (e) {
      toast.error("Could not do that", (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const r = run;
  return (
    <Drawer
      open={!!id}
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={r ? `${PROVIDER_LABEL[r.provider]} test, ${rupees(r.amount)}` : "Test run"}
      description={r ? `${r.school.name}, ${r.mode} mode, ${r.account === "school" ? "school's own account" : "server's account"}` : undefined}
      footer={
        r &&
        isOpen(r) && (
          <div className="flex flex-wrap justify-end gap-2">
            {r.status === "WAITING" && r.mode !== "mock" && r.provider !== "ONEBILL" && (
              <Button variant="secondary" icon={<RefreshCw />} loading={busy === 'refresh""'} onClick={() => act("refresh")}>
                Ask the gateway now
              </Button>
            )}
            {r.status === "WAITING" && r.mode === "mock" && (
              <>
                <Button variant="secondary" loading={busy === 'simulate{"approve":false}'} onClick={() => act("simulate", { approve: false })}>
                  Simulate decline
                </Button>
                <Button variant="secondary" loading={busy === 'simulate{"approve":true}'} onClick={() => act("simulate", { approve: true })}>
                  Simulate payment
                </Button>
              </>
            )}
            {r.receipt && !r.receipt.reversed ? (
              <Button icon={<Undo2 />} loading={busy === 'reverse""'} onClick={() => act("reverse", undefined, "Test payment reversed")}>
                Reverse test payment
              </Button>
            ) : (
              <Button variant="ghost" icon={<X />} loading={busy === 'cancel""'} onClick={() => act("cancel", undefined, "Test cancelled")}>
                Cancel test
              </Button>
            )}
          </div>
        )
      }
    >
      {error && !r && <ErrorState message={error} onRetry={load} />}
      {!r && !error && <SkeletonRows rows={4} columns={2} />}
      {r && (
        <div className="flex flex-col gap-5">
          <div>
            <Badge tone={RUN_STATUS[r.status].tone}>{RUN_STATUS[r.status].label}</Badge>
          </div>
          {r.status === "PAID" && (
            <Alert tone="info" title="The gateway took the money">
              Check the receipt below, then reverse the test so the school&apos;s totals are unchanged. Refund the payer from the gateway&apos;s
              merchant portal if they want the money back.
            </Alert>
          )}
          {r.status === "REVIEW" && (
            <Alert tone="warning" title="The gateway reported a different amount">
              Look at the checkout in the school&apos;s reconciliation before reversing.
            </Alert>
          )}
          {r.checkout?.consumerNumber && r.status === "WAITING" && (
            <Alert tone="info" title="Pay this 1Bill number from any banking app">
              <span className="font-mono text-base">{groupDigits(r.checkout.consumerNumber)}</span>
            </Alert>
          )}
          <DescriptionList
            items={[
              { label: "Started", value: `${when(r.timings.startedAt)}${r.startedBy ? ` by ${r.startedBy}` : ""}` },
              { label: "Reference", value: <span className="font-mono text-xs">{r.checkout?.txnRef ?? "None"}</span> },
              { label: "Checkout", value: r.checkout ? CHECKOUT_LABEL[r.checkout.status] : "Removed" },
              { label: "Gateway code", value: r.checkout?.responseCode ?? "None yet" },
              { label: "Gateway transaction", value: r.checkout?.providerRef ?? "None yet" },
              { label: "Gateway message", value: r.checkout?.message ?? "None yet" },
              { label: "First callback", value: r.callbackSeen ? `${when(r.timings.callbackAt!)} (${secs(r.timings.toCallback)})` : "Not seen yet" },
              { label: "Receipt", value: r.receipt ? `${r.receipt.receiptNo} (${secs(r.timings.toPaid)})${r.receipt.reversed ? ", reversed" : ""}` : "None yet" },
            ]}
          />
          <div className="flex flex-col gap-2">
            <h3 className="text-[13px] font-medium text-fg-secondary">Gateway calls</h3>
            {r.events.length === 0 ? (
              <p className="text-sm text-fg-muted">Nothing from the gateway yet{r.status === "WAITING" ? "; this page checks every few seconds." : "."}</p>
            ) : (
              <ol className="flex flex-col gap-1.5 text-sm">
                {r.events.map((e, i) => (
                  <li key={`${e.at}-${i}`} className="flex flex-wrap items-center gap-2">
                    <span className="tabular-nums text-fg-muted">{when(e.at)}</span>
                    <span className="text-fg">{CALL_LABEL[e.kind] ?? e.kind}</span>
                    <Badge tone={e.verified ? "success" : "danger"}>{e.verified ? "Verified" : "Not verified"}</Badge>
                    {e.status && <span className="text-fg-secondary">{CHECKOUT_LABEL[e.status]}</span>}
                    {e.code && <span className="font-mono text-xs text-fg-muted">code {e.code}</span>}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}
