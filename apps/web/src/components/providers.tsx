"use client";

import type { ReactNode } from "react";
import { ToastProvider } from "./kit/toast";
import { TooltipProvider } from "./kit/overlay";

/** App-wide client providers (toasts, tooltips). */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider>
      <ToastProvider>{children}</ToastProvider>
    </TooltipProvider>
  );
}
