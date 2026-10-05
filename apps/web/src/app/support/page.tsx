"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/brand";
import { Alert, Spinner, buttonClass } from "@/components/ui";
import { getSupportToken, startSupportSession } from "@/lib/api";

/**
 * Landing page for a support session opened from the SchoolSyncer console:
 * /support#token=...&school=...&expires=... The token arrives in the hash (never
 * sent to a server), is kept in this tab's sessionStorage and the tab moves on
 * to the school's dashboard.
 */
export default function SupportStartPage() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const token = params.get("token");
    // Drop the token from the address bar and history straight away.
    window.history.replaceState(null, "", window.location.pathname);
    if (token) {
      startSupportSession(token, { schoolName: params.get("school"), expiresAt: params.get("expires") });
    }
    if (getSupportToken()) {
      router.replace("/dashboard");
    } else {
      // Nothing usable in the link, or the browser blocks sessionStorage.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the URL hash only works in the browser
      setFailed(true);
    }
  }, [router]);

  return (
    <div className="grid min-h-dvh place-items-center bg-bg px-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
        <BrandMark className="size-10" />
        {failed ? (
          <>
            <Alert tone="danger" title="Could not start the support session">
              This link has no session in it, or the browser blocked storage for this tab. Start the session again from the SchoolSyncer console.
            </Alert>
            <Link href="/platform/schools" className={buttonClass("secondary")}>
              Back to the console
            </Link>
          </>
        ) : (
          <Spinner label="Starting support session" />
        )}
      </div>
    </div>
  );
}
