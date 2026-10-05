"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import {
  BookCopy,
  BookMarked,
  BookOpen,
  Clock,
  HandCoins,
  Library,
  Plus,
  Printer,
  RotateCcw,
  Save,
  ScanBarcode,
  Search,
  SlidersHorizontal,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  DataTable,
  Drawer,
  EmptyState,
  ErrorState,
  Field,
  Input,
  KpiCard,
  NativeSelect,
  PageHeader,
  SearchInput,
  SegmentedControl,
  SkeletonRows,
  StatGrid,
  StatusPill,
  TabPanel,
  Tabs,
  useToast,
  type Column,
} from "@/components/ui";
import { COPY_STATUS } from "@/components/library/copy-status";
import { api } from "@/lib/api";
import { day, rupees } from "@/lib/format";
import { daysOverdue, FINE_LABEL, type BookRow, type Loan } from "@/lib/library";
import { FEES, hasRole, SETUP, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

interface Summary {
  titles: number;
  copies: Record<string, number>;
  onLoan: number;
  overdue: number;
  finesDue: { amount: number; count: number };
  settings: { libraryLoanDays: number; libraryFinePerDay: number; libraryMaxLoans: number };
}

interface CopyLookup {
  id: string;
  accessionNo: string;
  status: string;
  book: { id: string; title: string; author: string | null };
  loan: Loan | null;
}

interface Borrower {
  kind: "student" | "staff";
  id: string;
  name: string;
  detail: string;
  onLoan: number;
}

type Tab = "desk" | "loans" | "catalogue" | "settings";

/** Issue and take back books by the number stamped inside them. */
function Desk({ onChange }: { onChange: () => Promise<void> }) {
  const [accessionNo, setAccessionNo] = useState("");
  const [copy, setCopy] = useState<CopyLookup | null>(null);
  const [search, setSearch] = useState("");
  const borrowerQuery = copy?.status === "AVAILABLE" && search.trim().length >= 2 ? `/library/borrowers?search=${encodeURIComponent(search.trim())}` : null;
  const borrowers = useApi<Borrower[]>(borrowerQuery);
  const [lostCharge, setLostCharge] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmLost, setConfirmLost] = useState(false);

  async function lookUp(event?: FormEvent) {
    event?.preventDefault();
    setError("");
    setNotice("");
    setCopy(null);
    setBusy(true);
    try {
      setCopy(await api<CopyLookup>(`/library/copies/${encodeURIComponent(accessionNo.trim())}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function act(run: () => Promise<string>) {
    setError("");
    setBusy(true);
    try {
      setNotice(await run());
      setCopy(null);
      setAccessionNo("");
      setSearch("");
      setLostCharge("");
      setConfirmLost(false);
      await onChange();
    } catch (e) {
      setError((e as Error).message);
      setConfirmLost(false);
    } finally {
      setBusy(false);
    }
  }

  const issue = (b: Borrower) =>
    act(async () => {
      const loan = await api<Loan>("/library/loans", {
        method: "POST",
        body: { accessionNo: copy!.accessionNo, ...(b.kind === "student" ? { studentId: b.id } : { userId: b.id }) },
      });
      return `${loan.title} lent to ${b.name}, due back ${day(loan.dueOn)}.`;
    });

  const giveBack = () =>
    act(async () => {
      const loan = await api<Loan>(`/library/loans/${copy!.loan!.id}/return`, { method: "POST" });
      return loan.fine
        ? `${loan.title} returned ${daysOverdue(loan.dueOn)} days late: fine ${rupees(loan.fine)}. Collect it now or it goes on the next fee voucher.`
        : `${loan.title} returned on time.`;
    });

  const markLost = () =>
    act(async () => {
      const loan = await api<Loan>(`/library/loans/${copy!.loan!.id}/lost`, { method: "POST", body: { charge: Number(lostCharge || 0) } });
      return `${loan.title} recorded as lost; ${loan.borrower.name} owes ${rupees(loan.fine ?? 0)}.`;
    });

  const status = copy ? COPY_STATUS[copy.status] : null;

  return (
    <Card className="max-w-3xl">
      <CardHeader title="Issue and return" description="Type the number stamped inside the book." icon={<ScanBarcode />} />
      <form onSubmit={lookUp} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-[13px] font-medium text-fg-secondary">Book number</span>
          <Input autoFocus className="h-11 w-44 text-lg tabular-nums" value={accessionNo} onChange={(e) => setAccessionNo(e.target.value)} placeholder="e.g. 42" />
        </label>
        <Button type="submit" className="h-11" icon={<Search />} loading={busy && !copy} disabled={!accessionNo.trim()}>Look up</Button>
      </form>
      {(error || notice) && (
        <div className="mt-4 flex flex-col gap-2">
          {error && <Alert tone="danger" onDismiss={() => setError("")}>{error}</Alert>}
          {notice && <Alert tone="success" onDismiss={() => setNotice("")}>{notice}</Alert>}
        </div>
      )}

      {copy && (
        <div className="mt-5 animate-rise border-t border-border pt-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-tint text-brand" aria-hidden><BookOpen className="size-5" /></span>
              <div className="min-w-0">
                <Link href={`/library/books/${copy.book.id}`} className="text-base font-semibold text-fg hover:text-brand">{copy.book.title}</Link>
                <p className="text-[13px] text-fg-muted">No. {copy.accessionNo}{copy.book.author && `, ${copy.book.author}`}</p>
              </div>
            </div>
            {status && <StatusPill status={copy.status} tone={status.tone} label={status.label} />}
          </div>

          {copy.status === "AVAILABLE" && (
            <div className="mt-4 flex flex-col gap-3">
              <SearchInput
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onClear={() => setSearch("")}
                placeholder="Lend to: type a student's name or admission number, or a teacher's name"
                aria-label="Find a borrower"
              />
              {!borrowerQuery ? (
                <p className="text-[13px] text-fg-muted">Type at least two letters to find a borrower.</p>
              ) : borrowers.error ? (
                <ErrorState compact message={borrowers.error} onRetry={borrowers.reload} />
              ) : !borrowers.data ? (
                <SkeletonRows rows={3} columns={2} />
              ) : borrowers.data.length === 0 ? (
                <EmptyState compact title="Nobody matches" description="Check the spelling or try an admission number." />
              ) : (
                <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                  {borrowers.data.map((b) => (
                    <li key={`${b.kind}-${b.id}`} className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <span className="flex min-w-0 items-center gap-2.5">
                        <Avatar name={b.name} size="sm" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-fg">{b.name}</span>
                          <span className="flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
                            {b.detail}
                            {b.onLoan > 0 && <Badge tone="info">has {b.onLoan}</Badge>}
                          </span>
                        </span>
                      </span>
                      <Button type="button" size="sm" variant="secondary" icon={<BookCopy />} disabled={busy} onClick={() => issue(b)} aria-label={`Lend to ${b.name}`}>Lend</Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {copy.status === "ON_LOAN" && copy.loan && (
            <div className="mt-4 flex flex-col gap-4 text-sm">
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 px-4 py-3">
                <Avatar name={copy.loan.borrower.name} size="sm" />
                <span>
                  With <strong className="font-semibold">{copy.loan.borrower.name}</strong> <span className="text-fg-muted">({copy.loan.borrower.detail})</span> since {day(copy.loan.issuedOn)}, due {day(copy.loan.dueOn)}
                </span>
                {copy.loan.overdue && <StatusPill status="OVERDUE" label={`${daysOverdue(copy.loan.dueOn)} days overdue`} />}
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <Button type="button" icon={<Undo2 />} loading={busy} onClick={giveBack}>Take back</Button>
                <span className="text-[13px] text-fg-muted">or if it&apos;s lost, charge</span>
                <Input type="number" min={0} className="h-9 w-28 tabular-nums" placeholder="Rs" aria-label="Charge for the lost book (Rs)" value={lostCharge} onChange={(e) => setLostCharge(e.target.value)} />
                <Button type="button" variant="danger" icon={<TriangleAlert />} disabled={busy} onClick={() => setConfirmLost(true)}>Mark lost</Button>
              </div>
            </div>
          )}
          {(copy.status === "LOST" || copy.status === "WITHDRAWN") && (
            <Alert tone="warning" className="mt-4">
              This copy is marked {copy.status.toLowerCase()}. Bring it back on the <Link className="font-medium underline" href={`/library/books/${copy.book.id}`}>book&apos;s page</Link> if it has turned up.
            </Alert>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirmLost}
        onOpenChange={setConfirmLost}
        title="Record this copy as lost?"
        description={copy?.loan ? `${copy.loan.borrower.name} will owe ${rupees(Number(lostCharge || 0))}.` : undefined}
        confirmLabel="Mark lost"
        destructive
        loading={busy}
        onConfirm={markLost}
      />
    </Card>
  );
}

type LoanStatus = "out" | "overdue" | "fines" | "recent";
const LOAN_VIEWS: { value: LoanStatus; label: string }[] = [
  { value: "overdue", label: "Overdue" },
  { value: "out", label: "All books out" },
  { value: "fines", label: "Fines to collect" },
  { value: "recent", label: "Recently returned" },
];
const LOAN_EMPTY: Record<LoanStatus, string> = {
  overdue: "No overdue books. Everything out is still within its loan period.",
  out: "No books are out right now.",
  fines: "No fines waiting to be collected.",
  recent: "No books returned recently.",
};

function Loans({ onChange }: { onChange: () => Promise<void> }) {
  const user = useSession();
  const toast = useToast();
  const [status, setStatus] = useState<LoanStatus>("overdue");
  const loans = useApi<Loan[]>(`/library/loans?status=${status}`);
  const [busy, setBusy] = useState<string | null>(null);
  const canWaive = hasRole(user, [...SETUP, ...FEES]);

  async function run(l: Loan, fn: () => Promise<unknown>, done: string) {
    setBusy(l.id);
    try {
      await fn();
      toast.success(done, l.title);
      await Promise.all([loans.reload(), onChange()]);
    } catch (e) {
      toast.error("Could not save", (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const settle = (l: Loan, action: "paid" | "waive") =>
    run(l, () => api(`/library/loans/${l.id}/fine`, { method: "POST", body: { action } }), action === "paid" ? "Fine collected" : "Fine let off");
  const giveBack = (l: Loan) => run(l, () => api(`/library/loans/${l.id}/return`, { method: "POST" }), "Book taken back");

  const showFine = status === "fines" || status === "recent";
  const columns: Column<Loan>[] = [
    {
      id: "book",
      header: "Book",
      sortValue: (l) => l.title,
      cell: (l) => <Link className="font-medium text-fg hover:text-brand print:text-inherit" href={`/library/books/${l.bookId}`}>{l.title}</Link>,
    },
    { id: "no", header: "No.", sortValue: (l) => l.accessionNo, cell: (l) => <span className="tabular-nums">{l.accessionNo}</span> },
    {
      id: "borrower",
      header: "Borrower",
      sortValue: (l) => l.borrower.name,
      cell: (l) => (
        <span className="block">
          {l.borrower.kind === "student" ? <Link className="hover:text-brand hover:underline print:no-underline" href={`/students/${l.borrower.id}`}>{l.borrower.name}</Link> : l.borrower.name}
          <span className="block text-xs text-fg-muted">{l.borrower.detail}</span>
        </span>
      ),
    },
    { id: "issued", header: "Issued", sortValue: (l) => l.issuedOn, cell: (l) => day(l.issuedOn), hideBelow: "md" },
    {
      id: "due",
      header: "Due",
      sortValue: (l) => l.dueOn,
      cell: (l) => (
        <span className="block">
          {day(l.dueOn)}
          {l.overdue && <span className="block text-xs font-medium text-danger-text">{daysOverdue(l.dueOn)} days late</span>}
        </span>
      ),
    },
    ...(showFine
      ? [{
          id: "fine",
          header: "Fine",
          align: "right" as const,
          sortValue: (l: Loan) => l.fine ?? 0,
          cell: (l: Loan) =>
            l.fine ? (
              <span className="block">
                {rupees(l.fine)}
                <span className="block text-xs text-fg-muted">{FINE_LABEL[l.fineStatus]}{l.lost && ", lost"}</span>
              </span>
            ) : l.returnedOn ? <span className="text-fg-muted">–</span> : null,
        }]
      : []),
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      className: "print:hidden",
      headerClassName: "print:hidden",
      cell: (l) => (
        <span className="inline-flex items-center justify-end gap-1.5 whitespace-nowrap">
          {!l.returnedOn && (
            <Button type="button" size="sm" variant="secondary" icon={<Undo2 />} loading={busy === l.id} onClick={() => giveBack(l)} aria-label={`Take back ${l.title} from ${l.borrower.name}`}>Take back</Button>
          )}
          {l.fineStatus === "DUE" && (
            <>
              <Button type="button" size="sm" variant="secondary" icon={<HandCoins />} disabled={busy === l.id} onClick={() => settle(l, "paid")} aria-label={`Fine paid by ${l.borrower.name}`}>Paid</Button>
              {canWaive && <Button type="button" size="sm" variant="ghost" disabled={busy === l.id} onClick={() => settle(l, "waive")} aria-label={`Let ${l.borrower.name} off the fine`}>Let off</Button>}
            </>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <SegmentedControl aria-label="Which loans" size="md" value={status} onChange={setStatus} options={LOAN_VIEWS} />
        <Button type="button" variant="secondary" size="sm" icon={<Printer />} className="ms-auto" onClick={() => window.print()}>Print</Button>
      </div>
      <h2 className="hidden text-lg font-semibold print:block">{LOAN_VIEWS.find((v) => v.value === status)?.label}</h2>
      <DataTable
        className="print:[&>div:first-child]:hidden"
        label={LOAN_VIEWS.find((v) => v.value === status)?.label ?? "Loans"}
        columns={columns}
        data={loans.data}
        error={loans.error}
        onRetry={loans.reload}
        getRowId={(l) => l.id}
        getSearchText={(l) => `${l.title} ${l.accessionNo} ${l.borrower.name} ${l.borrower.detail}`}
        searchPlaceholder="Search book, number or borrower"
        pageSize={0}
        maxHeight="70vh"
        rowClassName={(l) => (l.overdue && !l.returnedOn ? "[&>td:first-child]:shadow-[inset_3px_0_0_var(--danger)]" : undefined)}
        empty={{ title: "Nothing here", description: LOAN_EMPTY[status], icon: <BookMarked /> }}
      />
      {status === "fines" && <p className="text-xs text-fg-muted">Fines not collected at the desk are added to the student&apos;s next monthly fee voucher.</p>}
    </div>
  );
}

function Catalogue({ onChange }: { onChange: () => Promise<void> }) {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const query = new URLSearchParams({ ...(search.trim() && { search: search.trim() }), ...(category && { category }) }).toString();
  const books = useApi<BookRow[]>(`/library/books${query ? `?${query}` : ""}`);
  const categories = useApi<{ category: string; titles: number }[]>("/library/categories");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const f = new FormData(formEl);
    setError("");
    setSaving(true);
    try {
      const book = await api<{ title: string; copies: { accessionNo: string }[] }>("/library/books", {
        method: "POST",
        body: {
          title: f.get("title"),
          author: f.get("author") || null,
          isbn: f.get("isbn") || null,
          category: f.get("category") || null,
          language: f.get("language") || "English",
          shelf: f.get("shelf") || null,
          copies: Number(f.get("copies") || 1),
        },
      });
      const nos = book.copies.map((c) => c.accessionNo);
      const msg = `${book.title} added. Stamp ${nos.length === 1 ? `number ${nos[0]}` : `numbers ${nos[0]} to ${nos[nos.length - 1]}`} inside the ${nos.length === 1 ? "book" : "copies"}.`;
      setNotice(msg);
      toast.success("Book added", msg);
      formEl.reset();
      setAdding(false);
      await Promise.all([books.reload(), categories.reload(), onChange()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const columns: Column<BookRow>[] = [
    {
      id: "title",
      header: "Title",
      sortValue: (b) => b.title,
      cell: (b) => (
        <span className="flex flex-wrap items-center gap-2">
          <Link className="font-medium text-fg hover:text-brand" href={`/library/books/${b.id}`}>{b.title}</Link>
          {b.language !== "English" && <Badge tone="neutral">{b.language}</Badge>}
        </span>
      ),
    },
    { id: "author", header: "Author", sortValue: (b) => b.author, cell: (b) => b.author ?? "–", hideBelow: "sm" },
    { id: "category", header: "Category", sortValue: (b) => b.category, cell: (b) => b.category ?? "–", hideBelow: "md" },
    { id: "shelf", header: "Shelf", sortValue: (b) => b.shelf, cell: (b) => b.shelf ?? "–", hideBelow: "lg" },
    {
      id: "available",
      header: "On the shelf",
      align: "right",
      sortValue: (b) => b.available,
      cell: (b) => (
        <span className="inline-flex items-center justify-end gap-2">
          {b.available === 0 && b.copies > 0 && <StatusPill status="OUT" tone="warning" label="All out" />}
          <span>{b.available} of {b.copies}</span>
        </span>
      ),
    },
  ];

  const openAdd = () => {
    setError("");
    setAdding(true);
  };

  return (
    <div className="flex flex-col gap-3">
      {notice && <Alert tone="success" onDismiss={() => setNotice("")}>{notice}</Alert>}
      <DataTable
        label="Catalogue"
        columns={columns}
        data={books.data}
        error={books.error}
        onRetry={books.reload}
        getRowId={(b) => b.id}
        search={search}
        onSearchChange={setSearch}
        manualFiltering
        searchPlaceholder="Search title, author, ISBN or book number"
        filters={
          <NativeSelect
            aria-label="Category"
            wrapperClassName="w-52"
            placeholder="Every category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            options={(categories.data ?? []).map((c) => ({ value: c.category, label: `${c.category} (${c.titles})` }))}
          />
        }
        filtered={!!(search.trim() || category)}
        toolbarActions={<Button size="sm" icon={<Plus />} onClick={openAdd}>Add book</Button>}
        empty={{ title: "No books yet", description: "Add your first title and stamp its number inside.", icon: <Library />, action: <Button size="sm" icon={<Plus />} onClick={openAdd}>Add book</Button> }}
      />

      <Drawer
        open={adding}
        onOpenChange={setAdding}
        title="Add a book"
        description="Each copy gets its own number to stamp inside."
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setAdding(false)}>Cancel</Button>
            <Button type="submit" form="add-book" icon={<Plus />} loading={saving}>Add book</Button>
          </>
        }
      >
        <form id="add-book" onSubmit={add} className="flex flex-col gap-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Title" name="title" required />
          <Field label="Author" name="author" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category" name="category" list="library-categories" placeholder="Fiction" />
            <datalist id="library-categories">{categories.data?.map((c) => <option key={c.category} value={c.category} />)}</datalist>
            <Field label="Language" name="language" defaultValue="English" />
            <Field label="ISBN" name="isbn" />
            <Field label="Shelf" name="shelf" placeholder="B-3" />
            <Field label="Copies" name="copies" type="number" min={1} defaultValue={1} />
          </div>
        </form>
      </Drawer>
    </div>
  );
}

function Settings({ summary, onChange }: { summary: Summary; onChange: () => Promise<void> }) {
  const toast = useToast();
  const [s, setS] = useState(summary.settings);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setError("");
    setSaving(true);
    try {
      await api("/library/settings", { method: "PATCH", body: s });
      toast.success("Saved. New loans use these rules.");
      await onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="max-w-lg">
      <CardHeader title="Lending rules" icon={<SlidersHorizontal />} description="Students with an overdue book can't borrow another until it's back. Staff can borrow any number of books." />
      <div className="flex flex-col gap-4">
        <Field label="Days a student keeps a book" type="number" min={1} value={s.libraryLoanDays} onChange={(e) => setS({ ...s, libraryLoanDays: Number(e.target.value) })} />
        <Field label="Fine per day late (Rs)" type="number" min={0} value={s.libraryFinePerDay} onChange={(e) => setS({ ...s, libraryFinePerDay: Number(e.target.value) })} />
        <Field label="Books a student can have at once" type="number" min={1} value={s.libraryMaxLoans} onChange={(e) => setS({ ...s, libraryMaxLoans: Number(e.target.value) })} />
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex justify-end border-t border-border pt-4">
          <Button type="button" icon={<Save />} loading={saving} onClick={save}>Save</Button>
        </div>
      </div>
    </Card>
  );
}

export default function LibraryPage() {
  const user = useSession();
  const summary = useApi<Summary>("/library/summary");
  const [tab, setTab] = useState<Tab>("desk");
  const s = summary.data;
  const loading = !s && !summary.error;
  const tabs = [
    { value: "desk", label: "Issue and return", icon: <ScanBarcode /> },
    { value: "loans", label: "Books out", icon: <Clock />, count: s?.onLoan },
    { value: "catalogue", label: "Catalogue", icon: <Library />, count: s?.titles },
    ...(hasRole(user, SETUP) ? [{ value: "settings", label: "Rules", icon: <SlidersHorizontal /> }] : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Library"
        description="Lend and take back books, chase overdue loans and keep the catalogue up to date."
        breadcrumbs={[{ label: "Operations" }, { label: "Library" }]}
      />
      {summary.error ? (
        <ErrorState compact message={summary.error} onRetry={summary.reload} className="print:hidden" />
      ) : (
        <StatGrid className="print:hidden">
          <KpiCard label="Books" value={s ? (s.copies.AVAILABLE ?? 0) + (s.copies.ON_LOAN ?? 0) : 0} icon={<BookCopy />} loading={loading} hint={s ? `${s.titles} titles` : undefined} />
          <KpiCard label="Out now" value={s?.onLoan ?? 0} icon={<BookOpen />} tone="info" loading={loading} />
          <button type="button" className="rounded-xl text-left focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring" onClick={() => setTab("loans")} aria-label={`Overdue books: ${s?.overdue ?? 0}. Show books out`}>
            <KpiCard
              className="h-full transition-[box-shadow,border-color,transform] duration-150 hover:-translate-y-px hover:border-border-strong hover:shadow-raised"
              label="Overdue"
              value={<span className={s?.overdue ? "text-danger-text" : undefined}>{s?.overdue ?? 0}</span>}
              icon={<RotateCcw />}
              tone={s?.overdue ? "danger" : "neutral"}
              loading={loading}
              hint="Show books out"
            />
          </button>
          <KpiCard label="Fines to collect" value={rupees(s?.finesDue.amount ?? 0)} icon={<HandCoins />} tone="warning" loading={loading} hint={s ? `${s.finesDue.count} books` : undefined} />
        </StatGrid>
      )}
      <Tabs tabs={tabs} value={tab} onValueChange={(v) => setTab(v as Tab)} aria-label="Library sections" listClassName="print:hidden">
        <TabPanel value="desk">
          <Desk onChange={summary.reload} />
        </TabPanel>
        <TabPanel value="loans">
          <Loans onChange={summary.reload} />
        </TabPanel>
        <TabPanel value="catalogue">
          <Catalogue onChange={summary.reload} />
        </TabPanel>
        {hasRole(user, SETUP) && (
          <TabPanel value="settings">
            {s ? <Settings summary={s} onChange={summary.reload} /> : summary.error ? <ErrorState compact message={summary.error} onRetry={summary.reload} /> : <SkeletonRows rows={3} columns={1} />}
          </TabPanel>
        )}
      </Tabs>
    </div>
  );
}
