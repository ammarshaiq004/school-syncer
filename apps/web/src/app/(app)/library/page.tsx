"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Badge, Button, Card, ErrorText, Field, Notice, PageTitle, rowClass, tableClass } from "@/components/ui";
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

const inputClass = "rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20";
type Tab = "desk" | "loans" | "catalogue" | "settings";

/** Issue and take back books by the number stamped inside them. */
function Desk({ onChange }: { onChange: () => Promise<void> }) {
  const [accessionNo, setAccessionNo] = useState("");
  const [copy, setCopy] = useState<CopyLookup | null>(null);
  const [search, setSearch] = useState("");
  const borrowers = useApi<Borrower[]>(copy?.status === "AVAILABLE" && search.trim().length >= 2 ? `/library/borrowers?search=${encodeURIComponent(search.trim())}` : null);
  const [lostCharge, setLostCharge] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function lookUp(event?: FormEvent) {
    event?.preventDefault();
    setError("");
    setNotice("");
    setCopy(null);
    try {
      setCopy(await api<CopyLookup>(`/library/copies/${encodeURIComponent(accessionNo.trim())}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function act(run: () => Promise<string>) {
    setError("");
    try {
      setNotice(await run());
      setCopy(null);
      setAccessionNo("");
      setSearch("");
      setLostCharge("");
      await onChange();
    } catch (e) {
      setError((e as Error).message);
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

  return (
    <Card>
      <form onSubmit={lookUp} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Book number</span>
          <input autoFocus className={`${inputClass} w-40 text-lg`} value={accessionNo} onChange={(e) => setAccessionNo(e.target.value)} placeholder="e.g. 42" />
        </label>
        <Button type="submit" disabled={!accessionNo.trim()}>Look up</Button>
      </form>
      <div className="mt-3"><ErrorText>{error}</ErrorText><Notice>{notice}</Notice></div>

      {copy && (
        <div className="mt-4 border-t border-black/10 pt-4 dark:border-white/10">
          <p className="text-lg font-semibold">
            <Link href={`/library/books/${copy.book.id}`} className="hover:underline">{copy.book.title}</Link>
            <span className="ml-2 text-sm font-normal opacity-60">No. {copy.accessionNo}{copy.book.author && ` · ${copy.book.author}`}</span>
          </p>
          {copy.status === "AVAILABLE" && (
            <div className="mt-3 flex flex-col gap-2">
              <input className={inputClass} placeholder="Lend to: type a student's name or admission number, or a teacher's name" value={search} onChange={(e) => setSearch(e.target.value)} />
              <ul>
                {borrowers.data?.map((b) => (
                  <li key={`${b.kind}-${b.id}`} className="flex items-center justify-between border-t border-black/5 py-2 text-sm dark:border-white/10">
                    <span>{b.name} <span className="opacity-60">· {b.detail}{b.onLoan > 0 && ` · has ${b.onLoan}`}</span></span>
                    <button className="text-brand" onClick={() => issue(b)}>Lend</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {copy.status === "ON_LOAN" && copy.loan && (
            <div className="mt-3 flex flex-col gap-3 text-sm">
              <p>
                With <strong>{copy.loan.borrower.name}</strong> ({copy.loan.borrower.detail}) since {day(copy.loan.issuedOn)}, due {day(copy.loan.dueOn)}
                {copy.loan.overdue && <Badge tone="red">{daysOverdue(copy.loan.dueOn)} days overdue</Badge>}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={giveBack}>Take back</Button>
                <span className="opacity-60">or if it&apos;s lost, charge</span>
                <input type="number" min={0} className={`${inputClass} w-28`} placeholder="Rs" value={lostCharge} onChange={(e) => setLostCharge(e.target.value)} />
                <Button variant="ghost" onClick={markLost}>Mark lost</Button>
              </div>
            </div>
          )}
          {(copy.status === "LOST" || copy.status === "WITHDRAWN") && (
            <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">This copy is marked {copy.status.toLowerCase()}. Bring it back on the book&apos;s page if it has turned up.</p>
          )}
        </div>
      )}
    </Card>
  );
}

function Loans({ onChange }: { onChange: () => Promise<void> }) {
  const user = useSession();
  const [status, setStatus] = useState<"out" | "overdue" | "fines" | "recent">("overdue");
  const loans = useApi<Loan[]>(`/library/loans?status=${status}`);
  const [error, setError] = useState("");

  async function settle(l: Loan, action: "paid" | "waive") {
    setError("");
    try {
      await api(`/library/loans/${l.id}/fine`, { method: "POST", body: { action } });
      await Promise.all([loans.reload(), onChange()]);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function giveBack(l: Loan) {
    setError("");
    try {
      await api(`/library/loans/${l.id}/return`, { method: "POST" });
      await Promise.all([loans.reload(), onChange()]);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Card className="overflow-x-auto">
      <div className="mb-3 flex flex-wrap gap-2 print:hidden">
        {(["overdue", "out", "fines", "recent"] as const).map((s) => (
          <Button key={s} variant={status === s ? "primary" : "ghost"} onClick={() => setStatus(s)}>
            {{ overdue: "Overdue", out: "All books out", fines: "Fines to collect", recent: "Recently returned" }[s]}
          </Button>
        ))}
        <Button variant="ghost" className="ml-auto" onClick={() => window.print()}>Print</Button>
      </div>
      <ErrorText>{error || loans.error}</ErrorText>
      <table className={tableClass}>
        <thead className="opacity-60">
          <tr><th className="py-2">Book</th><th>No.</th><th>Borrower</th><th>Issued</th><th>Due</th><th>{status === "fines" || status === "recent" ? "Fine" : ""}</th><th className="print:hidden" /></tr>
        </thead>
        <tbody>
          {loans.data?.map((l) => (
            <tr key={l.id} className={rowClass}>
              <td className="py-2"><Link className="text-brand print:text-inherit" href={`/library/books/${l.bookId}`}>{l.title}</Link></td>
              <td>{l.accessionNo}</td>
              <td>
                {l.borrower.kind === "student" ? <Link className="hover:underline" href={`/students/${l.borrower.id}`}>{l.borrower.name}</Link> : l.borrower.name}
                <div className="text-xs opacity-60">{l.borrower.detail}</div>
              </td>
              <td>{day(l.issuedOn)}</td>
              <td>
                {day(l.dueOn)}
                {l.overdue && <div className="text-xs text-red-600">{daysOverdue(l.dueOn)} days late</div>}
              </td>
              <td>
                {l.fine ? <>{rupees(l.fine)} <span className="text-xs opacity-60">{FINE_LABEL[l.fineStatus]}{l.lost && " · lost"}</span></> : l.returnedOn ? <span className="opacity-50">–</span> : null}
              </td>
              <td className="whitespace-nowrap text-right print:hidden">
                {!l.returnedOn && <button className="text-sm text-brand" onClick={() => giveBack(l)}>Take back</button>}
                {l.fineStatus === "DUE" && (
                  <>
                    <button className="text-sm text-brand" onClick={() => settle(l, "paid")}>Paid</button>
                    {hasRole(user, [...SETUP, ...FEES]) && <button className="ml-3 text-sm opacity-60 hover:opacity-100" onClick={() => settle(l, "waive")}>Let off</button>}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {loans.data?.length === 0 && <p className="py-4 text-sm opacity-60">Nothing here.</p>}
      {status === "fines" && <p className="mt-3 text-xs opacity-60">Fines not collected at the desk are added to the student&apos;s next monthly fee voucher.</p>}
    </Card>
  );
}

function Catalogue({ onChange }: { onChange: () => Promise<void> }) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const query = new URLSearchParams({ ...(search.trim() && { search: search.trim() }), ...(category && { category }) }).toString();
  const books = useApi<BookRow[]>(`/library/books${query ? `?${query}` : ""}`);
  const categories = useApi<{ category: string; titles: number }[]>("/library/categories");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const f = new FormData(formEl);
    setError("");
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
      setNotice(`${book.title} added. Stamp ${nos.length === 1 ? `number ${nos[0]}` : `numbers ${nos[0]} to ${nos[nos.length - 1]}`} inside the ${nos.length === 1 ? "book" : "copies"}.`);
      formEl.reset();
      await Promise.all([books.reload(), categories.reload(), onChange()]);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <Card className="overflow-x-auto">
        <div className="mb-3 flex flex-wrap gap-3">
          <input className={`${inputClass} w-72`} placeholder="Search title, author, ISBN or book number" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
            <option value="">Every category</option>
            {categories.data?.map((c) => <option key={c.category} value={c.category}>{c.category} ({c.titles})</option>)}
          </select>
        </div>
        <table className={tableClass}>
          <thead className="opacity-60">
            <tr><th className="py-2">Title</th><th>Author</th><th>Category</th><th>Shelf</th><th>On the shelf</th></tr>
          </thead>
          <tbody>
            {books.data?.map((b) => (
              <tr key={b.id} className={rowClass}>
                <td className="py-2">
                  <Link className="text-brand" href={`/library/books/${b.id}`}>{b.title}</Link>
                  {b.language !== "English" && <span className="ml-2 text-xs opacity-60">{b.language}</span>}
                </td>
                <td>{b.author ?? "–"}</td>
                <td>{b.category ?? "–"}</td>
                <td>{b.shelf ?? "–"}</td>
                <td>{b.available} of {b.copies}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {books.data?.length === 0 && <p className="py-4 text-sm opacity-60">No books match.</p>}
      </Card>
      <Card>
        <h2 className="mb-4 font-semibold">Add a book</h2>
        <form onSubmit={add} className="flex flex-col gap-3">
          <Field label="Title" name="title" required />
          <Field label="Author" name="author" />
          <Field label="Category" name="category" list="library-categories" placeholder="Fiction" />
          <datalist id="library-categories">{categories.data?.map((c) => <option key={c.category} value={c.category} />)}</datalist>
          <Field label="Language" name="language" defaultValue="English" />
          <Field label="ISBN" name="isbn" />
          <Field label="Shelf" name="shelf" placeholder="B-3" />
          <Field label="Copies" name="copies" type="number" min={1} defaultValue={1} />
          <ErrorText>{error}</ErrorText>
          <Notice>{notice}</Notice>
          <Button type="submit">Add book</Button>
        </form>
      </Card>
    </div>
  );
}

function Settings({ summary, onChange }: { summary: Summary; onChange: () => Promise<void> }) {
  const [s, setS] = useState(summary.settings);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function save() {
    setError("");
    try {
      await api("/library/settings", { method: "PATCH", body: s });
      setNotice("Saved. New loans use these rules.");
      await onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Card className="max-w-md">
      <div className="flex flex-col gap-3">
        <Field label="Days a student keeps a book" type="number" min={1} value={s.libraryLoanDays} onChange={(e) => setS({ ...s, libraryLoanDays: Number(e.target.value) })} />
        <Field label="Fine per day late (Rs)" type="number" min={0} value={s.libraryFinePerDay} onChange={(e) => setS({ ...s, libraryFinePerDay: Number(e.target.value) })} />
        <Field label="Books a student can have at once" type="number" min={1} value={s.libraryMaxLoans} onChange={(e) => setS({ ...s, libraryMaxLoans: Number(e.target.value) })} />
        <p className="text-xs opacity-60">Students with an overdue book can&apos;t borrow another until it&apos;s back. Staff can borrow any number of books.</p>
        <ErrorText>{error}</ErrorText>
        <Notice>{notice}</Notice>
        <Button onClick={save}>Save</Button>
      </div>
    </Card>
  );
}

export default function LibraryPage() {
  const user = useSession();
  const summary = useApi<Summary>("/library/summary");
  const [tab, setTab] = useState<Tab>("desk");
  const s = summary.data;
  const tabs: [Tab, string][] = [
    ["desk", "Issue and return"],
    ["loans", "Books out"],
    ["catalogue", "Catalogue"],
    ...(hasRole(user, SETUP) ? ([["settings", "Rules"]] as [Tab, string][]) : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageTitle>Library</PageTitle>
      <ErrorText>{summary.error}</ErrorText>
      {s && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 print:hidden">
          <Card><div className="text-sm opacity-60">Books</div><div className="mt-1 text-2xl font-semibold">{(s.copies.AVAILABLE ?? 0) + (s.copies.ON_LOAN ?? 0)}</div><div className="text-xs opacity-60">{s.titles} titles</div></Card>
          <Card><div className="text-sm opacity-60">Out now</div><div className="mt-1 text-2xl font-semibold">{s.onLoan}</div></Card>
          <button className="text-left" onClick={() => setTab("loans")}>
            <Card className="h-full"><div className="text-sm opacity-60">Overdue</div><div className={`mt-1 text-2xl font-semibold ${s.overdue ? "text-red-600" : ""}`}>{s.overdue}</div></Card>
          </button>
          <Card><div className="text-sm opacity-60">Fines to collect</div><div className="mt-1 text-2xl font-semibold">{rupees(s.finesDue.amount)}</div><div className="text-xs opacity-60">{s.finesDue.count} books</div></Card>
        </div>
      )}
      <div className="flex gap-1 border-b border-black/10 dark:border-white/10 print:hidden">
        {tabs.map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} className={`-mb-px border-b-2 px-4 py-2 text-sm ${tab === t ? "border-brand font-medium text-brand" : "border-transparent opacity-70"}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === "desk" && <Desk onChange={summary.reload} />}
      {tab === "loans" && <Loans onChange={summary.reload} />}
      {tab === "catalogue" && <Catalogue onChange={summary.reload} />}
      {tab === "settings" && s && <Settings summary={s} onChange={summary.reload} />}
    </div>
  );
}
