"use client";

import { useState, type FormEvent } from "react";
import { BookMarked, Plus, X } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, DataTable, Drawer, Field, NativeSelect, StatusPill, useToast, type Column, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { day } from "@/lib/format";
import type { BookRow } from "@/lib/library";
import { useApi } from "@/lib/use-api";

interface Reservation {
  id: string;
  status: "WAITING" | "READY" | "FULFILLED" | "CANCELLED" | "EXPIRED";
  book: { id: string; title: string; author: string | null };
  borrower: { kind: "student" | "staff"; id: string; name: string; detail: string };
  /** Place in the queue while waiting. */
  position: number | null;
  /** The copy held at the desk while ready. */
  accessionNo: string | null;
  holdUntil: string | null;
}

interface Borrower {
  kind: "student" | "staff";
  id: string;
  name: string;
  detail: string;
}

const LABEL = { WAITING: "In the queue", READY: "Ready at the desk", FULFILLED: "Collected", CANCELLED: "Cancelled", EXPIRED: "Not collected" } as const;
const TONE: Record<Reservation["status"], Tone> = { WAITING: "warning", READY: "success", FULFILLED: "neutral", CANCELLED: "neutral", EXPIRED: "danger" };

/** Joins the queue for a book whose copies are all out. */
function ReserveDrawer({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; onDone: () => Promise<void> }) {
  const [search, setSearch] = useState("");
  const [bookSearch, setBookSearch] = useState("");
  const [bookId, setBookId] = useState("");
  const [borrowerId, setBorrowerId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const books = useApi<BookRow[]>(open && bookSearch.trim().length >= 2 ? `/library/books?search=${encodeURIComponent(bookSearch.trim())}` : null);
  const borrowers = useApi<Borrower[]>(open && search.trim().length >= 2 ? `/library/borrowers?search=${encodeURIComponent(search.trim())}` : null);
  const borrower = borrowers.data?.find((b) => b.id === borrowerId);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!borrower) return;
    setError("");
    setBusy(true);
    try {
      await api("/library/reservations", { method: "POST", body: { bookId, ...(borrower.kind === "student" ? { studentId: borrower.id } : { userId: borrower.id }) } });
      onOpenChange(false);
      setBookId("");
      setBorrowerId("");
      setSearch("");
      setBookSearch("");
      await onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="Reserve a book"
      description="For a title whose copies are all out. The next copy back is held at the desk for 3 days."
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="reserve-book" loading={busy} disabled={!bookId || !borrower}>Reserve</Button>
        </>
      }
    >
      <form id="reserve-book" onSubmit={submit} className="flex flex-col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Find the book" placeholder="Title, author or ISBN" value={bookSearch} onChange={(e) => { setBookSearch(e.target.value); setBookId(""); }} />
        {books.data && (
          <NativeSelect
            aria-label="Book"
            placeholder={books.data.length ? "Choose the book" : "No book found"}
            value={bookId}
            onChange={(e) => setBookId(e.target.value)}
            options={books.data.map((b) => ({ value: b.id, label: `${b.title}${b.author ? ` · ${b.author}` : ""} (${b.available} of ${b.copies} in)` }))}
          />
        )}
        <Field label="Find the borrower" placeholder="Student name, admission number or staff name" value={search} onChange={(e) => { setSearch(e.target.value); setBorrowerId(""); }} />
        {borrowers.data && (
          <NativeSelect
            aria-label="Borrower"
            placeholder={borrowers.data.length ? "Choose who is reserving" : "Nobody found"}
            value={borrowerId}
            onChange={(e) => setBorrowerId(e.target.value)}
            options={borrowers.data.map((b) => ({ value: b.id, label: `${b.name} · ${b.detail}` }))}
          />
        )}
      </form>
    </Drawer>
  );
}

/** Who is waiting for which book, and which returned copies are held at the desk. */
export function Reservations({ onChange }: { onChange: () => Promise<void> }) {
  const toast = useToast();
  const [all, setAll] = useState(false);
  const rows = useApi<Reservation[]>(`/library/reservations?status=${all ? "all" : "open"}`);
  const [adding, setAdding] = useState(false);

  async function cancel(r: Reservation) {
    try {
      await api(`/library/reservations/${r.id}/cancel`, { method: "POST" });
      toast.success("Reservation cancelled", r.book.title);
      await Promise.all([rows.reload(), onChange()]);
    } catch (e) {
      toast.error("Could not cancel", (e as Error).message);
    }
  }

  const open = (r: Reservation) => r.status === "WAITING" || r.status === "READY";
  const columns: Column<Reservation>[] = [
    { id: "book", header: "Book", sortValue: (r) => r.book.title, cell: (r) => <span className="font-medium text-fg">{r.book.title}</span> },
    {
      id: "borrower",
      header: "Reserved by",
      sortValue: (r) => r.borrower.name,
      cell: (r) => (
        <span className="block">
          {r.borrower.name}
          <span className="block text-xs text-fg-muted">{r.borrower.detail}</span>
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      sortValue: (r) => r.status,
      cell: (r) => (
        <span className="flex flex-col items-start gap-1">
          <StatusPill status={r.status} tone={TONE[r.status]} label={LABEL[r.status]} />
          {r.status === "WAITING" && <span className="text-xs text-fg-muted">Number {r.position} in line</span>}
          {r.status === "READY" && (
            <span className="text-xs text-fg-muted">
              Book {r.accessionNo}, collect by {r.holdUntil ? day(r.holdUntil) : "?"}
            </span>
          )}
        </span>
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (r) =>
        open(r) ? (
          <Button size="sm" variant="ghost" icon={<X />} onClick={() => cancel(r)}>
            Cancel
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title="Reservations"
          icon={<BookMarked />}
          description="When every copy of a title is out, a student or teacher can queue for it. The first book handed back is held at the issue desk for 3 days; borrowing it ends the reservation."
          action={
            <div className="flex items-center gap-2">
              <Badge tone="neutral">{(rows.data ?? []).filter(open).length} open</Badge>
              <Button size="sm" icon={<Plus />} onClick={() => setAdding(true)}>Reserve a book</Button>
            </div>
          }
        />
      </Card>
      <DataTable
        label="Reservations"
        columns={columns}
        data={rows.data}
        error={rows.error}
        onRetry={rows.reload}
        getRowId={(r) => r.id}
        getSearchText={(r) => `${r.book.title} ${r.borrower.name}`}
        searchPlaceholder="Search book or borrower"
        filters={<NativeSelect aria-label="Show" value={all ? "all" : "open"} onChange={(e) => setAll(e.target.value === "all")} options={[{ value: "open", label: "Open reservations" }, { value: "all", label: "Everything, with history" }]} wrapperClassName="w-56" />}
        empty={{ title: "Nothing reserved", description: "Reserve a title when all its copies are out.", icon: <BookMarked /> }}
      />
      <ReserveDrawer open={adding} onOpenChange={setAdding} onDone={async () => { await Promise.all([rows.reload(), onChange()]); }} />
    </div>
  );
}
