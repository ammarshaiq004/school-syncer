"use client";

import { useId, type ComponentProps, type ReactNode } from "react";
import { Check, ChevronDown, Minus, Search, X } from "lucide-react";
import { Checkbox as RCheckbox, Switch as RSwitch } from "radix-ui";
import { cn } from "@/lib/cn";
import { inputClass } from "./styles";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(inputClass, "h-9", className)} {...props} />;
}

export function Textarea({ className, rows = 4, ...props }: ComponentProps<"textarea">) {
  return <textarea rows={rows} className={cn(inputClass, "min-h-20 py-2 leading-relaxed", className)} {...props} />;
}

/** Label text above a control. */
export function FieldLabel({ children, required, className }: { children: ReactNode; required?: boolean; className?: string }) {
  return (
    <span className={cn("text-[13px] font-medium text-fg-secondary", className)}>
      {children}
      {required && <span className="ms-0.5 text-danger" aria-hidden>*</span>}
    </span>
  );
}

function FieldShell({
  label,
  hint,
  error,
  required,
  hintId,
  errorId,
  className,
  children,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  hintId: string;
  errorId: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1.5 text-sm", className)}>
      {label && <FieldLabel required={required}>{label}</FieldLabel>}
      {children}
      {error ? (
        <span id={errorId} className="text-xs text-danger-text">{error}</span>
      ) : hint ? (
        <span id={hintId} className="text-xs text-fg-muted">{hint}</span>
      ) : null}
    </label>
  );
}

export interface TextFieldProps extends ComponentProps<"input"> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Classes for the outer label wrapper. */
  wrapperClassName?: string;
}

/** Labelled input with optional hint and error text. */
export function TextField({ label, hint, error, wrapperClassName, className, required, ...props }: TextFieldProps) {
  const id = useId();
  return (
    <FieldShell label={label} hint={hint} error={error} required={required} hintId={`${id}-h`} errorId={`${id}-e`} className={wrapperClassName}>
      <input
        className={cn(inputClass, "h-9", className)}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-e` : hint ? `${id}-h` : undefined}
        {...props}
      />
    </FieldShell>
  );
}

export interface TextareaFieldProps extends ComponentProps<"textarea"> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  wrapperClassName?: string;
}

export function TextareaField({ label, hint, error, wrapperClassName, className, required, rows = 4, ...props }: TextareaFieldProps) {
  const id = useId();
  return (
    <FieldShell label={label} hint={hint} error={error} required={required} hintId={`${id}-h`} errorId={`${id}-e`} className={wrapperClassName}>
      <textarea
        rows={rows}
        className={cn(inputClass, "min-h-20 py-2 leading-relaxed", className)}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-e` : hint ? `${id}-h` : undefined}
        {...props}
      />
    </FieldShell>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface NativeSelectProps extends ComponentProps<"select"> {
  options?: SelectOption[];
  /** Adds a first option with value "" (e.g. "All sections"). */
  placeholder?: string;
  /** Classes for the wrapper (use for width, e.g. "w-48"). */
  wrapperClassName?: string;
}

/** Styled native <select>. Give it aria-label when there is no visible label. */
export function NativeSelect({ options, placeholder, wrapperClassName, className, children, ...props }: NativeSelectProps) {
  return (
    <span className={cn("relative inline-flex h-fit min-w-0", wrapperClassName)}>
      <select className={cn(inputClass, "h-9 cursor-pointer appearance-none pe-9", className)} {...props}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options?.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute end-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
    </span>
  );
}

export interface SelectFieldProps extends NativeSelectProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
}

/** Labelled NativeSelect. */
export function SelectField({ label, hint, error, wrapperClassName, required, ...props }: SelectFieldProps) {
  const id = useId();
  return (
    <FieldShell label={label} hint={hint} error={error} required={required} hintId={`${id}-h`} errorId={`${id}-e`} className={wrapperClassName}>
      <NativeSelect
        wrapperClassName="w-full"
        className="w-full"
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-e` : hint ? `${id}-h` : undefined}
        {...props}
      />
    </FieldShell>
  );
}

export interface SearchInputProps extends Omit<ComponentProps<"input">, "type"> {
  /** Shows a clear button when there is a value. */
  onClear?: () => void;
  wrapperClassName?: string;
}

/** Input with a search icon. aria-label defaults to "Search". */
export function SearchInput({ onClear, wrapperClassName, className, value, ...props }: SearchInputProps) {
  return (
    <span className={cn("relative inline-flex h-fit min-w-0", wrapperClassName)}>
      <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
      <input
        type="search"
        aria-label={props["aria-label"] ?? (typeof props.placeholder === "string" ? props.placeholder : "Search")}
        value={value}
        className={cn(inputClass, "h-9 ps-9 [&::-webkit-search-cancel-button]:hidden", onClear && "pe-8", className)}
        {...props}
      />
      {onClear && value !== undefined && value !== "" && (
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear search"
          className="absolute end-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-fg-muted hover:bg-surface-3 hover:text-fg"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </span>
  );
}

export interface CheckboxProps {
  checked: boolean | "indeterminate";
  onCheckedChange?: (checked: boolean) => void;
  /** Visible label. Without one, pass aria-label. */
  label?: ReactNode;
  "aria-label"?: string;
  disabled?: boolean;
  name?: string;
  value?: string;
  className?: string;
  id?: string;
}

/** Radix checkbox with indeterminate support. */
export function Checkbox({ checked, onCheckedChange, label, disabled, className, ...props }: CheckboxProps) {
  const box = (
    <RCheckbox.Root
      checked={checked}
      onCheckedChange={(c) => onCheckedChange?.(c === true)}
      disabled={disabled}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "peer grid size-4 shrink-0 place-items-center rounded border border-border-strong bg-surface text-primary-fg transition-colors duration-150 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary",
        !label && className,
      )}
      {...props}
    >
      <RCheckbox.Indicator className="data-[state=checked]:animate-fade-in">
        {checked === "indeterminate" ? <Minus className="size-3" strokeWidth={3} /> : <Check className="size-3" strokeWidth={3} />}
      </RCheckbox.Indicator>
    </RCheckbox.Root>
  );
  if (!label) return box;
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2 text-sm text-fg", disabled && "cursor-not-allowed opacity-60", className)}>
      {box}
      <span>{label}</span>
    </label>
  );
}

export interface SwitchProps {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  label?: ReactNode;
  "aria-label"?: string;
  disabled?: boolean;
  name?: string;
  className?: string;
}

/** On/off toggle (radix Switch). */
export function Switch({ checked, onCheckedChange, label, disabled, className, ...props }: SwitchProps) {
  const control = (
    <RSwitch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-border-strong transition-colors duration-150 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring disabled:opacity-50 data-[state=checked]:bg-primary"
      {...props}
    >
      <RSwitch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow-card transition-transform duration-150 data-[state=checked]:translate-x-[18px]" />
    </RSwitch.Root>
  );
  if (!label) return control;
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2.5 text-sm text-fg", className)}>
      {control}
      <span>{label}</span>
    </label>
  );
}
