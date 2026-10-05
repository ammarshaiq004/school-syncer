"use client";

import { useState } from "react";
import { Check, Copy, KeyRound } from "lucide-react";
import { Alert, Button } from "@/components/ui";

/** Shows a one-time temporary password with a copy button. */
export function TempPassword({ name, login, password }: { name: string; login?: string | null; password: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-fg-secondary">
        Share this with <span className="font-medium text-fg">{name}</span>
        {login ? (
          <>
            {" "}
            so they can sign in as <span className="font-medium text-fg">{login}</span>
          </>
        ) : null}
        . They should change it after signing in.
      </p>
      <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 px-4 py-3">
        <KeyRound className="size-4 shrink-0 text-fg-muted" aria-hidden />
        <code className="min-w-0 flex-1 select-all break-all font-mono text-base font-semibold tracking-wide text-fg" aria-label="Temporary password">
          {password}
        </code>
        <Button type="button" size="sm" variant="secondary" icon={copied ? <Check /> : <Copy />} onClick={copy} aria-live="polite">
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <Alert tone="warning">This password is shown only once. If it gets lost, reset the password again.</Alert>
    </div>
  );
}
