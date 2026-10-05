"use client";

import Link from "next/link";
import type { ReactElement, ReactNode } from "react";
import { Check, X } from "lucide-react";
import { Dialog as RDialog, DropdownMenu as RMenu, Popover as RPopover, Tooltip as RTooltip } from "radix-ui";
import { cn } from "@/lib/cn";
import { Button } from "./button";

/* ---------------------------------------------------------------- */
/* Dialog                                                            */
/* ---------------------------------------------------------------- */

const DIALOG_SIZE = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" } as const;

export interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Optional element that opens the dialog (uncontrolled use). */
  trigger?: ReactElement;
  title: ReactNode;
  description?: ReactNode;
  /** Buttons row, right-aligned. */
  footer?: ReactNode;
  size?: keyof typeof DIALOG_SIZE;
  children?: ReactNode;
  className?: string;
}

/** Centered modal that fades and scales in. Closes on Escape and overlay click. */
export function Dialog({ open, onOpenChange, trigger, title, description, footer, size = "md", children, className }: DialogProps) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <RDialog.Trigger asChild>{trigger}</RDialog.Trigger>}
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px] data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
        <RDialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-border bg-surface shadow-overlay focus:outline-none data-[state=closed]:animate-dialog-out data-[state=open]:animate-dialog-in",
            DIALOG_SIZE[size],
            className,
          )}
          {...(description ? {} : { "aria-describedby": undefined })}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <RDialog.Title className="font-display text-base font-semibold text-fg">{title}</RDialog.Title>
              {description && <RDialog.Description className="mt-1 text-[13px] text-fg-muted">{description}</RDialog.Description>}
            </div>
            <RDialog.Close className="-me-1 -mt-1 grid size-8 shrink-0 place-items-center rounded-lg text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg" aria-label="Close">
              <X className="size-4" aria-hidden />
            </RDialog.Close>
          </div>
          {children && <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>}
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3.5">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

/** Wrap a button with this to close the surrounding Dialog or Drawer. */
export const DialogClose = RDialog.Close;

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button. */
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
}

/** "Are you sure?" dialog. Keep it open while loading; close it in onConfirm when done. */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = "Confirm", cancelLabel = "Cancel", destructive, loading, onConfirm }: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button type="button" variant={destructive ? "danger" : "primary"} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}

/* ---------------------------------------------------------------- */
/* Drawer / Sheet                                                    */
/* ---------------------------------------------------------------- */

const DRAWER_SIZE = { sm: "sm:max-w-sm", md: "sm:max-w-md", lg: "sm:max-w-xl", xl: "sm:max-w-3xl" } as const;

export interface DrawerProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactElement;
  title: ReactNode;
  description?: ReactNode;
  /** Sticky footer (e.g. Save / Cancel). */
  footer?: ReactNode;
  /** Extra content in the header under the title (e.g. Tabs list, status pill). */
  headerExtra?: ReactNode;
  side?: "right" | "left";
  size?: keyof typeof DRAWER_SIZE;
  children?: ReactNode;
  /** Classes for the scrollable body. */
  bodyClassName?: string;
  /** Visually hide the title (still read by screen readers). */
  hideTitle?: boolean;
}

/** Side panel that slides in. Full width on phones. Use for record details and edit forms. */
export function Drawer({ open, onOpenChange, trigger, title, description, footer, headerExtra, side = "right", size = "md", children, bodyClassName, hideTitle }: DrawerProps) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <RDialog.Trigger asChild>{trigger}</RDialog.Trigger>}
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-overlay data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
        <RDialog.Content
          className={cn(
            "fixed inset-y-0 z-50 flex w-full flex-col border-border bg-surface shadow-overlay focus:outline-none",
            side === "right"
              ? "end-0 border-s data-[state=closed]:animate-sheet-out-right data-[state=open]:animate-sheet-in-right"
              : "start-0 border-e data-[state=closed]:animate-sheet-out-left data-[state=open]:animate-sheet-in-left",
            DRAWER_SIZE[size],
          )}
          {...(description ? {} : { "aria-describedby": undefined })}
        >
          <div className="shrink-0 border-b border-border px-5 py-4">
            <div className={cn("flex items-start gap-4", hideTitle ? "justify-end" : "justify-between")}>
              <div className={cn("min-w-0", hideTitle && "sr-only")}>
                <RDialog.Title className="font-display text-base font-semibold text-fg">{title}</RDialog.Title>
                {description && <RDialog.Description className="mt-1 text-[13px] text-fg-muted">{description}</RDialog.Description>}
              </div>
              <RDialog.Close className="-me-1 -mt-1 grid size-8 shrink-0 place-items-center rounded-lg text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg" aria-label="Close panel">
                <X className="size-4" aria-hidden />
              </RDialog.Close>
            </div>
            {headerExtra && <div className="mt-3">{headerExtra}</div>}
          </div>
          <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5", bodyClassName)}>{children}</div>
          {footer && <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border bg-surface px-5 py-3.5">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

/** Alias: Sheet = Drawer. */
export const Sheet = Drawer;

/* ---------------------------------------------------------------- */
/* Dropdown menu                                                     */
/* ---------------------------------------------------------------- */

const MENU_PANEL =
  "z-50 min-w-48 overflow-hidden rounded-lg border border-border bg-surface p-1 text-sm text-fg shadow-overlay data-[state=closed]:animate-pop-out data-[state=open]:animate-pop-in";
const MENU_ITEM =
  "relative flex cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-3 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-fg-muted";

export interface DropdownMenuProps {
  /** The element that opens the menu (Button or IconButton). */
  trigger: ReactElement;
  children: ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** Menu of actions. Children: DropdownItem, DropdownLabel, DropdownSeparator, DropdownCheckboxItem. */
export function DropdownMenu({ trigger, children, align = "end", side = "bottom", className, open, onOpenChange }: DropdownMenuProps) {
  return (
    <RMenu.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <RMenu.Trigger asChild>{trigger}</RMenu.Trigger>
      <RMenu.Portal>
        <RMenu.Content align={align} side={side} sideOffset={6} collisionPadding={8} className={cn(MENU_PANEL, "origin-[var(--radix-dropdown-menu-content-transform-origin)]", className)}>
          {children}
        </RMenu.Content>
      </RMenu.Portal>
    </RMenu.Root>
  );
}

export interface DropdownItemProps {
  children: ReactNode;
  icon?: ReactNode;
  /** Second line in muted text. */
  description?: ReactNode;
  onSelect?: () => void;
  /** Renders a Next link. */
  href?: string;
  /** Red text for destructive actions. */
  danger?: boolean;
  disabled?: boolean;
  /** Shows the item greyed out with this tooltip (still hoverable, unlike `disabled`). */
  disabledReason?: string;
  /** Marks the current choice with a check. */
  selected?: boolean;
  /** Right-aligned hint, e.g. a shortcut. */
  shortcut?: ReactNode;
}

export function DropdownItem({ children, icon, description, onSelect, href, danger, disabled, disabledReason, selected, shortcut }: DropdownItemProps) {
  const cls = cn(MENU_ITEM, danger && "text-danger-text [&_svg]:text-danger", disabledReason && "cursor-not-allowed opacity-50");
  const inner = (
    <>
      {icon}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{children}</span>
        {description && <span className="truncate text-xs text-fg-muted">{description}</span>}
      </span>
      {shortcut && <span className="ms-4 text-xs text-fg-muted">{shortcut}</span>}
      {selected && <Check className="ms-2 !text-brand" aria-hidden />}
    </>
  );
  if (disabledReason) {
    return (
      <Tooltip content={disabledReason} side="left">
        <RMenu.Item aria-disabled onSelect={(e) => e.preventDefault()} className={cls}>
          {inner}
        </RMenu.Item>
      </Tooltip>
    );
  }
  if (href) {
    return (
      <RMenu.Item asChild disabled={disabled} onSelect={onSelect} className={cls}>
        <Link href={href}>{inner}</Link>
      </RMenu.Item>
    );
  }
  return (
    <RMenu.Item disabled={disabled} onSelect={onSelect} className={cls}>
      {inner}
    </RMenu.Item>
  );
}

export function DropdownCheckboxItem({ children, checked, onCheckedChange, disabled }: { children: ReactNode; checked: boolean; onCheckedChange: (c: boolean) => void; disabled?: boolean }) {
  return (
    <RMenu.CheckboxItem
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      onSelect={(e) => e.preventDefault()}
      className={cn(MENU_ITEM, "ps-8")}
    >
      <RMenu.ItemIndicator className="absolute start-2.5">
        <Check className="!text-brand" aria-hidden />
      </RMenu.ItemIndicator>
      {children}
    </RMenu.CheckboxItem>
  );
}

export function DropdownLabel({ children }: { children: ReactNode }) {
  return <RMenu.Label className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">{children}</RMenu.Label>;
}

export function DropdownSeparator() {
  return <RMenu.Separator className="-mx-1 my-1 h-px bg-border" />;
}

/* ---------------------------------------------------------------- */
/* Tooltip and Popover                                               */
/* ---------------------------------------------------------------- */

/** Mounted once in the root providers. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RTooltip.Provider delayDuration={250} skipDelayDuration={100}>
      {children}
    </RTooltip.Provider>
  );
}

export interface TooltipProps {
  content: ReactNode;
  /** A single focusable element. */
  children: ReactElement;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  /** Skip the tooltip (renders children only). */
  disabled?: boolean;
}

/** Short hint on hover/focus. Not a replacement for aria-label on icon buttons. */
export function Tooltip({ content, children, side = "top", align = "center", disabled }: TooltipProps) {
  if (disabled || !content) return children;
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className="z-[60] max-w-64 rounded-md bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-overlay data-[state=closed]:animate-fade-out data-[state=delayed-open]:animate-pop-in data-[state=instant-open]:animate-fade-in dark:bg-slate-700"
        >
          {content}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

export interface PopoverProps {
  trigger: ReactElement;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}

/** Floating panel anchored to a trigger (filters, quick forms). */
export function Popover({ trigger, children, open, onOpenChange, align = "start", side = "bottom", className }: PopoverProps) {
  return (
    <RPopover.Root open={open} onOpenChange={onOpenChange}>
      <RPopover.Trigger asChild>{trigger}</RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content
          align={align}
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className={cn("z-50 w-72 rounded-xl border border-border bg-surface p-4 text-sm text-fg shadow-overlay focus:outline-none data-[state=closed]:animate-pop-out data-[state=open]:animate-pop-in", className)}
        >
          {children}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}

export const PopoverClose = RPopover.Close;
