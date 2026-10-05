"use client";

import { useState } from "react";
import { Check, Copy, KeyRound } from "lucide-react";
import { Alert, Button } from "@/components/ui";

/**
 * A temporary password the API returns once. It is never shown again, so the
 * staff member copies it now and passes it on.
 */
export function TempPassword({ password, login, note }: { password: string; login?: string | null; note?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the password stays selectable on screen.
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Alert tone="warning" title="Copy this password now">
        {note ?? "It is shown only once. If it gets lost, reset the password again."}
      </Alert>
      {login && (
        <div className="flex flex-col gap-1 text-sm">
          <span className="text-[13px] font-medium text-fg-secondary">Sign in with</span>
          <span className="break-all text-fg">{login}</span>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-fg-secondary">Temporary password</span>
        <div className="flex items-center gap-2">
          <code
            className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 font-mono text-sm text-fg select-all"
            aria-label="Temporary password"
          >
            <KeyRound className="size-4 shrink-0 text-fg-muted" aria-hidden />
            <span className="truncate">{password}</span>
          </code>
          <Button type="button" variant="secondary" icon={copied ? <Check /> : <Copy />} onClick={copy} aria-live="polite">
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </div>
    </div>
  );
}
