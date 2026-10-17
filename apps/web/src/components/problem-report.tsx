"use client";

import { useState, type FormEvent } from "react";
import { Bug, Image as ImageIcon, Inbox, Send } from "lucide-react";
import { FileUploadField, type FileLink } from "@/components/elearning/file-upload";
import { Alert, Badge, Button, Drawer, EmptyState, ErrorState, SegmentedControl, SkeletonRows, StatusPill, TextareaField, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { APP_VERSION } from "@/lib/build-version";
import { day } from "@/lib/format";
import { PROBLEM_STATUS_LABEL, PROBLEM_STATUS_TONE, type ProblemReport } from "@/lib/problem-reports";
import { useApi } from "@/lib/use-api";
import { relativeTime } from "./dashboard/shared";

type Pane = "new" | "mine" | "school";

/** The page the user is on, with its query, as the report records it. */
function currentPage() {
  if (typeof window === "undefined") return "";
  return `${window.location.pathname}${window.location.search}`.slice(0, 500);
}

/**
 * "Report a problem" (SCHOOL-150): a side panel any signed-in user opens from
 * the top bar. It sends the message with the page, app version and browser
 * (the API adds the role and school), and an optional screenshot through the
 * normal upload checks. The second pane lists the user's own reports and
 * where SchoolSyncer has got to; the school owner can also see everyone's.
 */
export function ProblemReportPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [pane, setPane] = useState<Pane>("new");
  // The page is taken when the panel opens, before anything in it changes the address.
  const [page, setPage] = useState("");
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setPage(currentPage());
  }
  const list = useApi<{ canSeeSchool: boolean; items: ProblemReport[] }>(
    open && pane !== "new" ? `/problem-reports${pane === "school" ? "?scope=school" : ""}` : null,
  );
  // Only owners are told about the school pane; the first list call says whether this user is one.
  const mine = useApi<{ canSeeSchool: boolean }>(open ? "/problem-reports" : null);
  const canSeeSchool = mine.data?.canSeeSchool ?? false;

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="Report a problem"
      description="Tell SchoolSyncer what went wrong. We see the page you were on, so you don't need to explain where."
      size="md"
      headerExtra={
        <SegmentedControl<Pane>
          aria-label="Report or see your reports"
          value={pane}
          onChange={setPane}
          options={[
            { value: "new", label: "New report", icon: <Bug /> },
            { value: "mine", label: "My reports", icon: <Inbox /> },
            ...(canSeeSchool ? [{ value: "school" as const, label: "Whole school" }] : []),
          ]}
        />
      }
    >
      {pane === "new" ? (
        <NewReport
          page={page}
          onSent={() => {
            void mine.reload();
            setPane("mine");
          }}
        />
      ) : list.error ? (
        <ErrorState compact message={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <SkeletonRows rows={4} columns={1} />
      ) : list.data.items.length === 0 ? (
        <EmptyState
          compact
          icon={<Inbox />}
          title={pane === "school" ? "No reports from the school" : "You have not reported anything"}
          description="Reports you send appear here with what SchoolSyncer has done about them."
        />
      ) : (
        <ul className="flex flex-col gap-3" aria-label={pane === "school" ? "Reports from the school" : "Your reports"}>
          {list.data.items.map((r) => (
            <ReportItem key={r.id} report={r} showReporter={pane === "school"} />
          ))}
        </ul>
      )}
    </Drawer>
  );
}

function NewReport({ page, onSent }: { page: string; onSent: () => void }) {
  const toast = useToast();
  const [message, setMessage] = useState("");
  const [screenshot, setScreenshot] = useState<FileLink | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSending(true);
    setError("");
    try {
      await api("/problem-reports", {
        method: "POST",
        body: {
          message,
          page: page || "/",
          source: "WEB",
          appVersion: APP_VERSION,
          browser: navigator.userAgent.slice(0, 500),
          ...(screenshot ? { screenshotId: screenshot.id } : {}),
        },
      });
      setMessage("");
      setScreenshot(null);
      toast.success("Report sent", "Thank you. You can follow it under My reports.");
      onSent();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <TextareaField
        label="What went wrong?"
        required
        rows={6}
        minLength={5}
        maxLength={4000}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="What you were doing, what you expected and what happened instead"
      />
      <FileUploadField
        label="Screenshot (optional)"
        hint="A picture of the screen helps us find the problem. PNG or JPG up to 5 MB."
        endpoint="/problem-reports/screenshot"
        accept=".png,.jpg,.jpeg,.webp,.gif"
        value={screenshot}
        onChange={setScreenshot}
        disabled={sending}
      />
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-surface-2 px-3 py-2.5 text-[13px]">
        <dt className="text-fg-muted">Page</dt>
        <dd className="truncate font-mono text-xs leading-5 text-fg-secondary">{page || "/"}</dd>
        <dt className="text-fg-muted">App version</dt>
        <dd className="text-fg-secondary">{APP_VERSION}</dd>
      </dl>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex justify-end">
        <Button type="submit" icon={<Send />} loading={sending} disabled={message.trim().length < 5}>
          Send report
        </Button>
      </div>
    </form>
  );
}

function ReportItem({ report: r, showReporter }: { report: ProblemReport; showReporter: boolean }) {
  const [shot, setShot] = useState<string | null>(null);
  const [loadingShot, setLoadingShot] = useState(false);
  async function openShot() {
    setLoadingShot(true);
    try {
      const detail = await api<{ screenshot: { url: string } | null }>(`/problem-reports/${r.id}`);
      setShot(detail.screenshot?.url ?? null);
    } finally {
      setLoadingShot(false);
    }
  }
  return (
    <li className="rounded-lg border border-border p-3.5">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 whitespace-pre-line break-words text-sm text-fg">{r.message}</p>
        <StatusPill status={r.status} tone={PROBLEM_STATUS_TONE[r.status]} label={PROBLEM_STATUS_LABEL[r.status]} className="shrink-0" />
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
        <time dateTime={r.createdAt}>{relativeTime(r.createdAt)}</time>
        <span aria-hidden>·</span>
        <span className="truncate font-mono">{r.page}</span>
        {r.source === "MOBILE" && <Badge tone="neutral">Mobile app</Badge>}
        {showReporter && <span>· {r.reporterName}</span>}
      </p>
      {r.history.length > 0 && (
        <ol className="mt-2 flex flex-col gap-0.5 border-s-2 border-border ps-3 text-xs text-fg-secondary" aria-label="Status changes">
          {r.history.map((h) => (
            <li key={h.at}>
              {day(h.at)}: {PROBLEM_STATUS_LABEL[h.status]}
            </li>
          ))}
        </ol>
      )}
      {r.hasScreenshot &&
        (shot ? (
          // A signed link to the school's own upload.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shot} alt="Screenshot sent with the report" className="mt-3 max-h-64 rounded-md border border-border" />
        ) : (
          <Button variant="ghost" size="sm" className="mt-2" icon={<ImageIcon />} loading={loadingShot} onClick={() => void openShot()}>
            Show screenshot
          </Button>
        ))}
    </li>
  );
}
