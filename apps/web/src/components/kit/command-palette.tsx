"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent } from "react";
import { CornerDownLeft, Search, SearchX } from "lucide-react";
import { Dialog as RDialog } from "radix-ui";
import { cn } from "@/lib/cn";

export interface PaletteCommand {
  id: string;
  label: string;
  /** Section heading, e.g. "Academics". */
  group: string;
  icon?: ComponentType<{ className?: string }>;
  /** Navigate here when chosen. */
  href?: string;
  /** Or run this. */
  onSelect?: () => void;
  /** Extra search words. */
  keywords?: string;
  /** Muted text on the right (e.g. the path). */
  hint?: string;
}

function score(cmd: PaletteCommand, q: string): number {
  if (!q) return 1;
  const label = cmd.label.toLowerCase();
  if (label.startsWith(q)) return 100 - label.length;
  if (label.includes(q)) return 60 - label.indexOf(q);
  const hay = `${label} ${cmd.group.toLowerCase()} ${cmd.keywords?.toLowerCase() ?? ""}`;
  if (q.split(/\s+/).every((w) => hay.includes(w))) return 30;
  // Subsequence match on the label ("atnd" -> Attendance).
  let i = 0;
  for (const ch of label) if (ch === q[i]) i++;
  return i === q.length ? 10 : 0;
}

/** True for Cmd+K / Ctrl+K. */
export const isPaletteHotkey = (e: globalThis.KeyboardEvent) => (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: PaletteCommand[];
  placeholder?: string;
  /** Looks up records (e.g. students) for what was typed; results are listed after the pages. */
  onSearch?: (query: string) => Promise<PaletteCommand[]>;
  /** How many characters before onSearch runs. */
  searchMinChars?: number;
}

/** Cmd/Ctrl+K jump-to dialog. The hotkey listener is built in; mount once in the shell. */
export function CommandPalette({
  open,
  onOpenChange,
  commands,
  placeholder = "Search pages and actions",
  onSearch,
  searchMinChars = 2,
}: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  /** Results of the last finished lookup, with the query they were for (older ones are ignored). */
  const [found, setFound] = useState<{ q: string; items: PaletteCommand[] }>({ q: "", items: [] });
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (isPaletteHotkey(e)) {
        e.preventDefault();
        setQuery("");
        setActive(0);
        onOpenChange(!open);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  // Record lookups go to the server, so wait for a short pause in typing.
  useEffect(() => {
    const q = query.trim();
    if (!onSearch || q.length < searchMinChars) return;
    let cancelled = false;
    const t = setTimeout(() => {
      onSearch(q).then(
        (items) => !cancelled && setFound({ q, items }),
        // A failed lookup simply adds nothing; the pages still work.
        () => !cancelled && setFound({ q, items: [] }),
      );
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, onSearch, searchMinChars]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pages = commands
      .map((c, i) => ({ c, s: score(c, q), i }))
      .filter((r) => r.s > 0)
      .sort((a, b) => (q ? b.s - a.s : a.i - b.i))
      .map((r) => r.c);
    // Looked-up records go last: a name that matches no page then stands alone at the top.
    return [...pages, ...(found.q === query.trim() ? found.items : [])];
  }, [commands, query, found]);

  const groups = useMemo(() => {
    const map = new Map<string, PaletteCommand[]>();
    for (const r of results) map.set(r.group, [...(map.get(r.group) ?? []), r]);
    return [...map.entries()];
  }, [results]);
  const flat = groups.flatMap(([, items]) => items);
  const current = Math.min(active, Math.max(0, flat.length - 1));

  function run(cmd: PaletteCommand) {
    onOpenChange(false);
    if (cmd.onSelect) cmd.onSelect();
    else if (cmd.href) router.push(cmd.href);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = (current + (e.key === "ArrowDown" ? 1 : -1) + flat.length) % Math.max(1, flat.length);
      setActive(next);
      listRef.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && flat[current]) {
      e.preventDefault();
      run(flat[current]);
    }
  }

  let index = -1;
  return (
    <RDialog.Root
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setQuery("");
          setActive(0);
        }
        onOpenChange(o);
      }}
    >
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px] data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
        <RDialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-[12vh] z-50 flex max-h-[min(560px,76vh)] w-[calc(100vw-1.5rem)] max-w-xl -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-overlay focus:outline-none data-[state=closed]:animate-pop-out data-[state=open]:animate-pop-in"
        >
          <RDialog.Title className="sr-only">Search</RDialog.Title>
          <div className="flex items-center gap-3 border-b border-border px-4">
            <Search className="size-4 shrink-0 text-fg-muted" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              aria-label={placeholder}
              role="combobox"
              aria-expanded
              aria-controls="palette-list"
              aria-activedescendant={flat[current] ? `palette-${flat[current].id}` : undefined}
              className="h-12 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-disabled"
            />
            <kbd className="hidden rounded border border-border bg-surface-2 px-1.5 py-0.5 font-sans text-[10px] font-medium text-fg-muted sm:inline">Esc</kbd>
          </div>
          <div ref={listRef} id="palette-list" role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto p-2">
            {flat.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-fg-muted">
                <SearchX className="size-5" aria-hidden />
                Nothing matches &ldquo;{query}&rdquo;
              </div>
            ) : (
              groups.map(([group, items]) => (
                <div key={group} role="group" aria-label={group} className="mb-1">
                  <p className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">{group}</p>
                  {items.map((cmd) => {
                    index++;
                    const i = index;
                    const Icon = cmd.icon;
                    const on = i === current;
                    return (
                      <div
                        key={cmd.id}
                        id={`palette-${cmd.id}`}
                        role="option"
                        aria-selected={on}
                        data-index={i}
                        onMouseMove={() => active !== i && setActive(i)}
                        onClick={() => run(cmd)}
                        className={cn(
                          "flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors duration-75",
                          on ? "bg-primary-tint text-brand" : "text-fg",
                        )}
                      >
                        {Icon && <Icon className={cn("size-4 shrink-0", on ? "text-brand" : "text-fg-muted")} />}
                        <span className="flex-1 truncate">{cmd.label}</span>
                        {cmd.hint && <span className="truncate text-xs text-fg-muted">{cmd.hint}</span>}
                        {on && <CornerDownLeft className="size-3.5 shrink-0" aria-hidden />}
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
          <div className="hidden items-center gap-4 border-t border-border bg-surface-2 px-4 py-2 text-[11px] text-fg-muted sm:flex">
            <span><kbd className="font-sans font-semibold">↑↓</kbd> to move</span>
            <span><kbd className="font-sans font-semibold">Enter</kbd> to open</span>
          </div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
