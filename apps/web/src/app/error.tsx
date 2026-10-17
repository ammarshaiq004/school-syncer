"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui";
import { reportError } from "@/lib/error-reporting";

/** A page that crashed while rendering: reported to the error tracker, with a way to try again. */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportError(error, { tags: { kind: "render", ...(error.digest && { digest: error.digest }) } });
  }, [error]);
  return (
    <div className="grid min-h-[60dvh] place-items-center">
      <ErrorState
        title="Something went wrong on this page"
        message={error.digest ? `Reference ${error.digest}. Try again, or tell support the reference if it keeps happening.` : "Try again. If it keeps happening, tell support what you were doing."}
        onRetry={reset}
      />
    </div>
  );
}
