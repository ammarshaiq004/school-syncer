"use client";

import Link from "next/link";
import { LifeBuoy } from "lucide-react";
import { BrandMark } from "@/components/brand";
import { Button, buttonClass } from "@/components/ui";

/** Shown after a support session ends (by the End session button or when it expires). */
export default function SupportEndedPage() {
  return (
    <div className="grid min-h-dvh place-items-center bg-bg px-4">
      <main className="flex w-full max-w-md flex-col items-center gap-5 text-center">
        <BrandMark className="size-10" />
        <span className="grid size-12 place-items-center rounded-xl bg-primary-tint text-brand">
          <LifeBuoy className="size-6" aria-hidden />
        </span>
        <div>
          <h1 className="text-2xl font-semibold text-fg">Support session ended</h1>
          <p className="mt-2 text-sm text-fg-muted">
            You are no longer signed in to the school in this tab. The session is recorded in the school&apos;s audit log and in the console.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button type="button" variant="secondary" onClick={() => window.close()}>
            Close this tab
          </Button>
          <Link href="/platform/schools" className={buttonClass("primary")}>
            Back to the console
          </Link>
        </div>
      </main>
    </div>
  );
}
