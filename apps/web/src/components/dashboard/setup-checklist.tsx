"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Check, Circle, ListChecks, X } from "lucide-react";
import { Badge, Button, Card, CardHeader, ProgressBar, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useApi } from "@/lib/use-api";

export interface ChecklistItem {
  key: string;
  label: string;
  done: boolean;
  optional: boolean;
  href: string;
  hint: string;
}

export interface SetupChecklist {
  items: ChecklistItem[];
  done: number;
  total: number;
  complete: boolean;
  dismissedAt: string | null;
  visible: boolean;
}

/**
 * The owner's setup checklist (SCHOOL-150): what is done and what is left
 * before the school can run a month in SchoolSyncer, each item linking to the
 * screen that does it. Hidden once every required item is done, or when the
 * owner dismisses it.
 */
export function SetupChecklistCard() {
  const toast = useToast();
  const checklist = useApi<SetupChecklist>("/dashboard/setup-checklist");
  const [hiding, setHiding] = useState(false);
  const c = checklist.data;
  if (!c?.visible) return null;

  async function dismiss() {
    setHiding(true);
    try {
      await api("/dashboard/setup-checklist/dismiss", { method: "POST" });
      await checklist.reload();
    } catch (e) {
      toast.error("Could not hide the checklist", (e as Error).message);
    } finally {
      setHiding(false);
    }
  }

  // Unfinished items first, so the next step is at the top.
  const items = [...c.items].sort((a, b) => Number(a.done) - Number(b.done) || Number(a.optional) - Number(b.optional));
  return (
    <Card>
      <CardHeader
        icon={<ListChecks />}
        title="Get the school ready"
        description={`${c.done} of ${c.total} steps done. Finish these before running a month in SchoolSyncer.`}
        action={
          <Button variant="ghost" size="sm" icon={<X />} loading={hiding} onClick={() => void dismiss()}>
            Hide
          </Button>
        }
      />
      <ProgressBar value={c.done} max={c.total} label="Setup progress" valueText={`${c.done}/${c.total}`} tone="success" size="sm" className="mb-4" />
      <ul className="grid gap-x-6 sm:grid-cols-2" aria-label="Setup steps">
        {items.map((i) => (
          <li key={i.key} className="border-b border-border last:border-b-0 sm:[&:nth-last-child(2):nth-child(odd)]:border-b-0">
            <Link href={i.href} className="group flex items-start gap-3 rounded-md px-1 py-2.5 hover:bg-surface-2">
              <span
                className={cn(
                  "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full",
                  i.done ? "bg-success text-white" : "text-fg-muted",
                )}
                aria-hidden
              >
                {i.done ? <Check className="size-3.5" /> : <Circle className="size-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("flex items-center gap-2 text-sm font-medium", i.done ? "text-fg-secondary" : "text-fg")}>
                  {i.label}
                  <span className="sr-only">{i.done ? "(done)" : "(not done)"}</span>
                  {i.optional && <Badge tone="neutral">Optional</Badge>}
                </span>
                <span className="block text-xs text-fg-muted">{i.hint}</span>
              </span>
              {!i.done && <ArrowRight className="mt-0.5 size-4 shrink-0 text-fg-muted group-hover:text-brand" aria-hidden />}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
