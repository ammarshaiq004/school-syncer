"use client";

import { useMemo, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, SearchX, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton, Button } from "./button";
import { Checkbox, NativeSelect, SearchInput } from "./inputs";
import { EmptyState, ErrorState, Skeleton } from "./feedback";

export type SortDir = "asc" | "desc";
export interface SortState {
  id: string;
  dir: SortDir;
}

export interface Column<T> {
  /** Unique id (used for sorting state and React keys). */
  id: string;
  header: ReactNode;
  /** Cell renderer. Must not call hooks. */
  cell: (row: T, index: number) => ReactNode;
  /** Value used to sort this column. Setting it makes the column sortable unless sortable=false. */
  sortValue?: (row: T) => string | number | Date | null | undefined;
  sortable?: boolean;
  align?: "left" | "right" | "center";
  /** CSS width, e.g. "120px", "30%". */
  width?: string;
  /** Hide on small screens. */
  hideBelow?: "sm" | "md" | "lg";
  className?: string;
  headerClassName?: string;
}

const HIDE = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell" } as const;
const ALIGN = { left: "text-left", right: "text-right tabular-nums", center: "text-center" } as const;

export interface DataTableEmpty {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  /** Rows. null/undefined while loading. */
  data: T[] | null | undefined;
  getRowId: (row: T) => string;
  /** Accessible name of the table, e.g. "Students". */
  label: string;
  /** Defaults to `data == null && !error`. */
  loading?: boolean;
  /** Error message; shows ErrorState in place of rows. */
  error?: string | null;
  onRetry?: () => void;
  /** Turn on the client-side search box: return the text to match for a row. */
  getSearchText?: (row: T) => string;
  searchPlaceholder?: string;
  /** Controlled search (e.g. to send it to the server). With manualFiltering the table does not filter. */
  search?: string;
  onSearchChange?: (value: string) => void;
  manualFiltering?: boolean;
  /** Filter controls rendered next to the search box (NativeSelect, SegmentedControl...). */
  filters?: ReactNode;
  /** Right side of the toolbar (export, add buttons). */
  toolbarActions?: ReactNode;
  /** True when filters outside the table are active (changes the empty message). */
  filtered?: boolean;
  empty?: DataTableEmpty;
  defaultSort?: SortState;
  /** Client page size; 0 disables paging. Default 25. */
  pageSize?: number;
  pageSizeOptions?: number[];
  /** Server paging: the table shows `data` as-is and renders this Pagination. */
  serverPagination?: PaginationProps;
  /** Adds a checkbox column. */
  selectable?: boolean;
  /** Actions shown in the bulk bar when rows are selected. */
  bulkActions?: (selected: T[], clear: () => void) => ReactNode;
  onRowClick?: (row: T) => void;
  /** aria-label for clickable rows. */
  getRowLabel?: (row: T) => string;
  /** Extra classes per row (e.g. highlight). */
  rowClassName?: (row: T) => string | undefined;
  /** Scroll height for sticky header, e.g. "60vh". */
  maxHeight?: string;
  zebra?: boolean;
  /** 40px rows instead of 44px. */
  dense?: boolean;
  /** No outer border/radius (when placed inside a Card with padding="none"). */
  bare?: boolean;
  /** Rendered as <tfoot> (totals row). */
  footer?: ReactNode;
  skeletonRows?: number;
  className?: string;
}

function compare(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "en", { numeric: true, sensitivity: "base" });
}

const INTERACTIVE = "a,button,input,select,textarea,label,[role=menuitem],[data-row-ignore]";

/**
 * Generic table with search, sorting, paging, selection and loading/empty/error states.
 * Client-side by default; pass serverPagination + manualFiltering for server data.
 */
export function DataTable<T>(props: DataTableProps<T>) {
  const {
    columns, data, getRowId, label, error, onRetry, getSearchText, searchPlaceholder = "Search",
    filters, toolbarActions, filtered, empty, defaultSort, pageSize: initialPageSize = 25,
    pageSizeOptions = [10, 25, 50, 100], serverPagination, selectable, bulkActions, onRowClick, getRowLabel,
    rowClassName, maxHeight, zebra = true, dense, bare, footer, skeletonRows = 6, className, manualFiltering,
  } = props;
  const loading = props.loading ?? (data == null && !error);

  const [innerSearch, setInnerSearch] = useState("");
  const search = props.search ?? innerSearch;
  const [sort, setSort] = useState<SortState | null>(defaultSort ?? null);
  const [pageState, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  function onSearch(v: string) {
    if (props.onSearchChange) props.onSearchChange(v);
    if (props.search === undefined) setInnerSearch(v);
    setPage(1);
  }

  const rows = useMemo(() => {
    let out = data ?? [];
    const q = search.trim().toLowerCase();
    if (q && getSearchText && !manualFiltering) out = out.filter((r) => getSearchText(r).toLowerCase().includes(q));
    if (sort) {
      const col = columns.find((c) => c.id === sort.id);
      if (col?.sortValue) {
        const get = col.sortValue;
        out = [...out].sort((a, b) => compare(get(a), get(b)) * (sort.dir === "asc" ? 1 : -1));
      }
    }
    return out;
  }, [data, search, getSearchText, manualFiltering, sort, columns]);

  const paged = !serverPagination && pageSize > 0;
  const pageCount = paged ? Math.max(1, Math.ceil(rows.length / pageSize)) : 1;
  const page = Math.min(pageState, pageCount);
  const visible = paged ? rows.slice((page - 1) * pageSize, page * pageSize) : rows;

  const ids = useMemo(() => new Set((data ?? []).map(getRowId)), [data, getRowId]);
  const selectedRows = (data ?? []).filter((r) => selected.has(getRowId(r)));
  const selectedCount = selectedRows.length;
  const visibleIds = visible.map(getRowId);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someVisibleSelected = visibleIds.some((id) => selected.has(id));

  function toggleAll(on: boolean) {
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => ids.has(id)));
      visibleIds.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });
  }
  function toggleOne(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set([...prev].filter((x) => ids.has(x)));
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  const clearSelection = () => setSelected(new Set());

  function toggleSort(col: Column<T>) {
    setSort((s) => (s?.id === col.id ? { id: col.id, dir: s.dir === "asc" ? "desc" : "asc" } : { id: col.id, dir: "asc" }));
  }

  const colCount = columns.length + (selectable ? 1 : 0);
  const hasToolbar = Boolean(getSearchText || props.onSearchChange || filters || toolbarActions);
  const isFiltered = Boolean(filtered || search.trim());

  function rowClick(e: MouseEvent<HTMLTableRowElement>, row: T) {
    if (!onRowClick) return;
    if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
    onRowClick(row);
  }
  function rowKey(e: KeyboardEvent<HTMLTableRowElement>, row: T) {
    if (!onRowClick || e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onRowClick(row);
    }
  }

  const rowH = dense ? "h-10" : "h-11";

  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)}>
      {hasToolbar && (
        <div className="flex flex-wrap items-center gap-2">
          {(getSearchText || props.onSearchChange) && (
            <SearchInput
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              onClear={() => onSearch("")}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              wrapperClassName="w-full sm:w-72"
            />
          )}
          {filters}
          {toolbarActions && <div className="ms-auto flex flex-wrap items-center gap-2">{toolbarActions}</div>}
        </div>
      )}

      {selectable && selectedCount > 0 && (
        <div className="flex animate-rise flex-wrap items-center gap-2 rounded-lg border border-primary/20 bg-primary-tint px-3 py-2 text-sm" role="region" aria-label="Bulk actions">
          <span className="font-medium text-brand">{selectedCount} selected</span>
          <div className="flex flex-wrap items-center gap-2">{bulkActions?.(selectedRows, clearSelection)}</div>
          <Button type="button" variant="ghost" size="sm" className="ms-auto" icon={<X />} onClick={clearSelection}>
            Clear
          </Button>
        </div>
      )}

      <div
        className={cn("relative min-w-0 overflow-auto bg-surface", !bare && "rounded-xl border border-border shadow-card")}
        style={maxHeight ? ({ maxHeight } as CSSProperties) : undefined}
      >
        <table className="w-full border-separate border-spacing-0 text-left text-sm" aria-label={label} aria-busy={loading || undefined}>
          <thead>
            <tr>
              {selectable && (
                <th scope="col" className="sticky top-0 z-10 w-10 border-b border-border bg-surface-2 ps-4">
                  <Checkbox
                    aria-label="Select all rows on this page"
                    checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false}
                    onCheckedChange={toggleAll}
                    disabled={loading || visible.length === 0}
                  />
                </th>
              )}
              {columns.map((col) => {
                const sortable = col.sortable ?? Boolean(col.sortValue);
                const active = sort?.id === col.id;
                return (
                  <th
                    key={col.id}
                    scope="col"
                    style={col.width ? { width: col.width } : undefined}
                    aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : sortable ? "none" : undefined}
                    className={cn(
                      "sticky top-0 z-10 h-10 whitespace-nowrap border-b border-border bg-surface-2 px-4 text-xs font-medium uppercase tracking-[0.04em] text-fg-muted",
                      ALIGN[col.align ?? "left"],
                      col.hideBelow && HIDE[col.hideBelow],
                      col.headerClassName,
                    )}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col)}
                        className={cn("-mx-1 inline-flex items-center gap-1 rounded px-1 uppercase transition-colors hover:text-fg", active && "text-fg", col.align === "right" && "flex-row-reverse")}
                      >
                        {col.header}
                        {active ? (
                          <ArrowUp className={cn("size-3.5 transition-transform duration-150", sort!.dir === "desc" && "rotate-180")} aria-hidden />
                        ) : (
                          <ChevronsUpDown className="size-3.5 opacity-40" aria-hidden />
                        )}
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: skeletonRows }, (_, i) => (
                <tr key={`sk-${i}`} className={rowH}>
                  {selectable && <td className="border-b border-border ps-4"><Skeleton className="size-4" /></td>}
                  {columns.map((col, c) => (
                    <td key={col.id} className={cn("border-b border-border px-4", col.hideBelow && HIDE[col.hideBelow])}>
                      <Skeleton className={cn("h-3.5", c === 0 ? "w-32" : "w-20", col.align === "right" && "ms-auto")} />
                    </td>
                  ))}
                </tr>
              ))
            ) : error ? (
              <tr>
                <td colSpan={colCount}>
                  <ErrorState compact message={error} onRetry={onRetry} />
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={colCount}>
                  {isFiltered ? (
                    <EmptyState
                      compact
                      icon={<SearchX />}
                      title="No matching results"
                      description="Try a different search or clear the filters."
                      action={search ? <Button type="button" variant="secondary" size="sm" onClick={() => onSearch("")}>Clear search</Button> : undefined}
                    />
                  ) : (
                    <EmptyState compact title={empty?.title ?? "Nothing here yet"} description={empty?.description} action={empty?.action} icon={empty?.icon} />
                  )}
                </td>
              </tr>
            ) : (
              visible.map((row, i) => {
                const id = getRowId(row);
                const isSel = selected.has(id);
                return (
                  <tr
                    key={id}
                    onClick={onRowClick ? (e) => rowClick(e, row) : undefined}
                    onKeyDown={onRowClick ? (e) => rowKey(e, row) : undefined}
                    tabIndex={onRowClick ? 0 : undefined}
                    aria-label={onRowClick && getRowLabel ? getRowLabel(row) : undefined}
                    aria-selected={selectable ? isSel : undefined}
                    className={cn(
                      rowH,
                      "transition-colors duration-100",
                      zebra && "even:bg-surface-2/70",
                      "hover:bg-surface-3/70",
                      isSel && "!bg-primary-tint",
                      onRowClick && "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
                      rowClassName?.(row),
                    )}
                  >
                    {selectable && (
                      <td className="border-b border-border ps-4">
                        <Checkbox aria-label={`Select ${getRowLabel?.(row) ?? "row"}`} checked={isSel} onCheckedChange={(on) => toggleOne(id, on)} />
                      </td>
                    )}
                    {columns.map((col) => (
                      <td
                        key={col.id}
                        className={cn(
                          "border-b border-border px-4 py-2 text-fg",
                          ALIGN[col.align ?? "left"],
                          col.hideBelow && HIDE[col.hideBelow],
                          col.className,
                        )}
                      >
                        {col.cell(row, i)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
          {footer && !loading && !error && visible.length > 0 && <tfoot className="bg-surface-2 font-medium">{footer}</tfoot>}
        </table>
      </div>

      {serverPagination ? (
        <Pagination {...serverPagination} />
      ) : (
        paged &&
        !loading &&
        !error &&
        rows.length > Math.min(...pageSizeOptions, pageSize) && (
          <Pagination
            page={page}
            pageSize={pageSize}
            total={rows.length}
            onPageChange={setPage}
            pageSizeOptions={pageSizeOptions}
            onPageSizeChange={(s) => {
              setPageSize(s);
              setPage(1);
            }}
          />
        )
      )}
    </div>
  );
}

export interface PaginationProps {
  /** 1-based page number. */
  page: number;
  pageSize: number;
  /** Total rows across all pages. */
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  className?: string;
}

function pageWindow(page: number, count: number): (number | "gap")[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const out: (number | "gap")[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(count - 1, page + 1);
  if (start > 2) out.push("gap");
  for (let p = start; p <= end; p++) out.push(p);
  if (end < count - 1) out.push("gap");
  out.push(count);
  return out;
}

/** "Showing 1-25 of 312" with page buttons. Works for client or server paging. */
export function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange, pageSizeOptions = [10, 25, 50, 100], className }: PaginationProps) {
  const count = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3 text-[13px] text-fg-muted", className)}>
      <div className="flex items-center gap-3">
        <span aria-live="polite" className="tabular-nums">
          Showing {from.toLocaleString("en-PK")}-{to.toLocaleString("en-PK")} of {total.toLocaleString("en-PK")}
        </span>
        {onPageSizeChange && (
          <NativeSelect
            aria-label="Rows per page"
            value={String(pageSize)}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            options={pageSizeOptions.map((n) => ({ value: String(n), label: `${n} / page` }))}
            className="h-8 text-[13px]"
          />
        )}
      </div>
      <nav aria-label="Pagination" className="flex items-center gap-1">
        <IconButton size="sm" variant="secondary" aria-label="Previous page" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft className="rtl:rotate-180" />
        </IconButton>
        <span className="hidden items-center gap-1 sm:flex">
          {pageWindow(page, count).map((p, i) =>
            p === "gap" ? (
              <span key={`g${i}`} className="px-1" aria-hidden>
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => onPageChange(p)}
                aria-current={p === page ? "page" : undefined}
                className={cn(
                  "h-8 min-w-8 rounded-lg px-2 font-medium tabular-nums transition-colors",
                  p === page ? "bg-primary-tint text-brand" : "hover:bg-surface-3 hover:text-fg",
                )}
              >
                {p}
              </button>
            ),
          )}
        </span>
        <span className="px-1 tabular-nums sm:hidden">
          {page} / {count}
        </span>
        <IconButton size="sm" variant="secondary" aria-label="Next page" disabled={page >= count} onClick={() => onPageChange(page + 1)}>
          <ChevronRight className="rtl:rotate-180" />
        </IconButton>
      </nav>
    </div>
  );
}
