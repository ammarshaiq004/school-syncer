"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/error-reporting";

/** The last resort when the root layout itself fails: plain markup, reported to the error tracker. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportError(error, { level: "fatal", tags: { kind: "global", ...(error.digest && { digest: error.digest }) } });
  }, [error]);
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100dvh", margin: 0 }}>
        <div style={{ textAlign: "center", maxWidth: 420, padding: 24 }}>
          <h1 style={{ fontSize: 18 }}>SchoolSyncer could not load</h1>
          <p style={{ color: "#64748b", fontSize: 14 }}>{error.digest ? `Reference ${error.digest}. ` : ""}Reload the page, or try again in a minute.</p>
          <button type="button" onClick={reset} style={{ marginTop: 12, padding: "8px 16px", borderRadius: 8, border: "1px solid #cbd5e1", background: "white", cursor: "pointer" }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
