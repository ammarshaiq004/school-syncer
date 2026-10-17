"use client";

import { useEffect } from "react";
import { errorReportingEnabled, reportError } from "@/lib/error-reporting";

/** Sends uncaught errors and unhandled promise rejections to the tracker (when NEXT_PUBLIC_SENTRY_DSN is set). */
export function ErrorListener() {
  useEffect(() => {
    if (!errorReportingEnabled()) return;
    const onError = (e: ErrorEvent) => reportError(e.error ?? e.message, { tags: { kind: "onerror" } });
    const onRejection = (e: PromiseRejectionEvent) => reportError(e.reason, { tags: { kind: "unhandledrejection" } });
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
