import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-black/10 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/5 ${className}`}>
      {children}
    </div>
  );
}

export function Button({
  className = "",
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" }) {
  const look =
    variant === "primary"
      ? "bg-brand text-white hover:opacity-90"
      : "border border-black/15 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10";
  return (
    <button
      className={`rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 ${look} ${className}`}
      {...props}
    />
  );
}

export function Field({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <input
        className="rounded-lg border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-brand dark:border-white/20"
        {...props}
      />
    </label>
  );
}

export function TextArea({ label, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <textarea
        className="rounded-lg border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-brand dark:border-white/20"
        rows={4}
        {...props}
      />
    </label>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="text-sm text-red-600" role="alert">{children}</p>;
}

export function Notice({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="text-sm text-green-700 dark:text-green-400" role="status">{children}</p>;
}

export function PageTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold">{children}</h1>
      {action}
    </div>
  );
}

const BADGE: Record<string, string> = {
  green: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  red: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  blue: "bg-brand/10 text-brand",
  gray: "bg-black/5 dark:bg-white/10",
};

export function Badge({ tone = "gray", children }: { tone?: keyof typeof BADGE; children: ReactNode }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${BADGE[tone]}`}>{children}</span>;
}

export const tableClass = "w-full text-left text-sm [&_th]:whitespace-nowrap [&_th]:pr-4 [&_td]:pr-4";
export const rowClass = "border-t border-black/5 dark:border-white/10";
