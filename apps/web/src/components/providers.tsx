"use client";

import type { ReactNode } from "react";
import { ToastProvider } from "./kit/toast";
import { TooltipProvider } from "./kit/overlay";
import { ErrorListener } from "./error-listener";

/** App-wide client providers (toasts, tooltips) and the error tracker's listener. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider>
      <ToastProvider>
        <ErrorListener />
        {children}
      </ToastProvider>
    </TooltipProvider>
  );
}
