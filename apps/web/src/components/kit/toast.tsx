"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/cn";

export type ToastTone = "success" | "danger" | "warning" | "info" | "neutral";

export interface ToastInput {
  title: ReactNode;
  description?: ReactNode;
  tone?: ToastTone;
  /** ms before auto-dismiss; default 4500 (7000 for danger). 0 keeps it open. */
  duration?: number;
  action?: { label: string; onClick: () => void };
}

interface ToastItem extends ToastInput {
  id: number;
}

export interface ToastApi {
  toast: (t: ToastInput) => number;
  success: (title: ReactNode, description?: ReactNode) => number;
  error: (title: ReactNode, description?: ReactNode) => number;
  info: (title: ReactNode, description?: ReactNode) => number;
  dismiss: (id: number) => void;
}

const noop: ToastApi = { toast: () => 0, success: () => 0, error: () => 0, info: () => 0, dismiss: () => {} };
const ToastContext = createContext<ToastApi>(noop);

/** toast.success("Saved"), toast.error("Could not save", err.message) ... */
export const useToast = () => useContext(ToastContext);

const ICON: Record<ToastTone, ReactNode> = {
  success: <CircleCheck className="text-success" />,
  danger: <CircleAlert className="text-danger" />,
  warning: <TriangleAlert className="text-warning" />,
  info: <Info className="text-info" />,
  neutral: <Info className="text-fg-muted" />,
};

/** Mounted once in the root providers. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);

  const dismiss = useCallback((id: number) => setItems((all) => all.filter((t) => t.id !== id)), []);
  const toast = useCallback((t: ToastInput) => {
    const id = next.current++;
    setItems((all) => [...all.slice(-4), { ...t, id }]);
    return id;
  }, []);

  const value = useMemo<ToastApi>(
    () => ({
      toast,
      dismiss,
      success: (title, description) => toast({ title, description, tone: "success" }),
      error: (title, description) => toast({ title, description, tone: "danger" }),
      info: (title, description) => toast({ title, description, tone: "info" }),
    }),
    [toast, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-relevant="additions"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-[100] flex flex-col items-end gap-2 sm:inset-x-auto sm:end-4 print:hidden"
      >
        {items.map((t) => (
          <Toast key={t.id} item={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const { id } = item;
  const tone = item.tone ?? "neutral";
  const duration = item.duration ?? (tone === "danger" ? 7000 : 4500);
  useEffect(() => {
    if (!duration) return;
    const timer = setTimeout(() => onDismiss(id), duration);
    return () => clearTimeout(timer);
  }, [duration, onDismiss, id]);
  const onClose = () => onDismiss(id);

  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className="pointer-events-auto flex w-full max-w-sm animate-toast-in items-start gap-3 rounded-xl border border-border bg-surface p-3.5 text-sm shadow-overlay sm:w-96"
    >
      <span className="mt-0.5 shrink-0 [&_svg]:size-[18px]" aria-hidden>{ICON[tone]}</span>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-fg">{item.title}</p>
        {item.description && <p className="mt-0.5 text-[13px] text-fg-muted">{item.description}</p>}
        {item.action && (
          <button
            type="button"
            onClick={() => {
              item.action!.onClick();
              onClose();
            }}
            className="mt-2 text-[13px] font-medium text-brand hover:underline"
          >
            {item.action.label}
          </button>
        )}
      </div>
      <button type="button" onClick={onClose} aria-label="Dismiss notification" className={cn("-m-1 shrink-0 rounded-md p-1 text-fg-muted hover:bg-surface-3 hover:text-fg")}>
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
