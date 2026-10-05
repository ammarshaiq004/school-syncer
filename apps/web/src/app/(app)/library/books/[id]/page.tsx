"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Archive, BookCopy, BookOpen, Pencil, Plus, RotateCcw, Save, TrendingUp } from "lucide-react";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  DataTable,
  DescriptionList,
  Drawer,
  ErrorState,
  Field,
  IconButton,
  Input,
  KpiCard,
  PageHeader,
  SkeletonCards,
  SkeletonRows,
  StatGrid,
  StatusPill,
  useToast,
  type Column,
} from "@/components/ui";
import { COPY_STATUS } from "@/components/library/copy-status";
import { api } from "@/lib/api";
import { day } from "@/lib/format";
import { daysOverdue, type Loan } from "@/lib/library";
import { useApi } from "@/lib/use-api";

interface Copy { id: string; accessionNo: string; status: string; addedOn: string; campus: { name: string } | null; loan: Loan | null }
interface BookDetail {
  id: string;
  title: string;
  author: string | null;
  isbn: string | null;
  publisher: string | null;
  category: string | null;
  language: string;
  shelf: string | null;
  timesBorrowed: number;
  copies: Copy[];
}

const FIELDS = [
  ["title", "Title"],
  ["author", "Author"],
  ["category", "Category"],
  ["language", "Language"],
  ["isbn", "ISBN"],
  ["publisher", "Publisher"],
  ["shelf", "Shelf"],
] as const;

export default function BookPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const book = useApi<BookDetail>(`/library/books/${id}`);
  const [editing, setEditing] = useState(false);
  const [count, setCount] = useState("1");
  const [error, setError] = useState("");
  const [editError, setEditError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const b = book.data;

  async function run(key: string, action: () => Promise<string>) {
    setError("");
    setNotice("");
    setBusy(key);
    try {
      const msg = await action();
      setNotice(msg);
      toast.success(msg);
      await book.reload();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function save(form: FormData) {
    setEditError("");
    setBusy("save");
    try {
      await api(`/library/books/${id}`, {
        method: "PATCH",
        body: Object.fromEntries(FIELDS.map(([k]) => [k, (form.get(k) as string) || (k === "title" || k === "language" ? undefined : null)])),
      });
      setEditing(false);
      toast.success("Saved.");
      await book.reload();
    } catch (e) {
      setEditError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const crumbs = [{ label: "Library", href: "/library" }, { label: b?.title ?? "Book" }];
  if (!b)
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Book" breadcrumbs={crumbs} />
        {book.error ? <ErrorState message={book.error} onRetry={book.reload} /> : <><SkeletonCards count={3} /><SkeletonRows rows={4} /></>}
      </div>
    );

  const onShelf = b.copies.filter((c) => c.status === "AVAILABLE").length;
  const onLoan = b.copies.filter((c) => c.status === "ON_LOAN").length;
  const inStock = b.copies.filter((c) => c.status !== "WITHDRAWN").length;
  const setStatus = (c: Copy, status: "WITHDRAWN" | "AVAILABLE") =>
    run(c.id, async () => {
      await api(`/library/copies/${c.id}`, { method: "PATCH", body: { status } });
      return status === "WITHDRAWN" ? `Copy ${c.accessionNo} withdrawn.` : `Copy ${c.accessionNo} is back on the shelf.`;
    });

  const columns: Column<Copy>[] = [
    { id: "no", header: "No.", sortValue: (c) => Number(c.accessionNo) || c.accessionNo, cell: (c) => <span className="font-medium tabular-nums">{c.accessionNo}</span> },
    {
      id: "status",
      header: "Status",
      sortValue: (c) => c.status,
      cell: (c) => {
        const st = COPY_STATUS[c.status];
        return <StatusPill status={c.status} tone={st?.tone} label={st?.label} />;
      },
    },
    {
      id: "with",
      header: "With",
      cell: (c) =>
        c.loan ? (
          <span className="block">
            {c.loan.borrower.kind === "student" ? <Link className="text-brand hover:underline" href={`/students/${c.loan.borrower.id}`}>{c.loan.borrower.name}</Link> : c.loan.borrower.name}
            <span className="block text-xs text-fg-muted">{c.loan.borrower.detail}</span>
          </span>
        ) : <span className="text-fg-muted">–</span>,
    },
    {
      id: "due",
      header: "Due",
      sortValue: (c) => c.loan?.dueOn,
      cell: (c) =>
        c.loan ? (
          <span className="block">
            {day(c.loan.dueOn)}
            {c.loan.overdue && <span className="block text-xs font-medium text-danger-text">{daysOverdue(c.loan.dueOn)} days late</span>}
          </span>
        ) : <span className="text-fg-muted">–</span>,
      hideBelow: "sm",
    },
    { id: "campus", header: "Campus", cell: (c) => c.campus?.name ?? "–", hideBelow: "lg" },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (c) =>
        c.status === "AVAILABLE" ? (
          <Button type="button" size="sm" variant="ghost" icon={<Archive />} loading={busy === c.id} onClick={() => setStatus(c, "WITHDRAWN")} aria-label={`Withdraw copy ${c.accessionNo}`}>Withdraw</Button>
        ) : c.status === "LOST" || c.status === "WITHDRAWN" ? (
          <Button type="button" size="sm" variant="secondary" icon={<RotateCcw />} loading={busy === c.id} onClick={() => setStatus(c, "AVAILABLE")} aria-label={`Back on shelf, copy ${c.accessionNo}`}>Back on shelf</Button>
        ) : null,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={b.title}
        breadcrumbs={crumbs}
        leading={<span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary-tint text-brand" aria-hidden><BookOpen className="size-5" /></span>}
        description={[b.author, b.category, b.language !== "English" && b.language, b.shelf && `shelf ${b.shelf}`].filter(Boolean).join(" · ") || undefined}
        meta={
          onShelf > 0 ? <StatusPill status="AVAILABLE" tone="success" label={`${onShelf} of ${inStock} on the shelf`} /> : <StatusPill status="OUT" tone="warning" label={inStock ? "All copies out" : "No copies in stock"} />
        }
        actions={<Button variant="secondary" icon={<Pencil />} onClick={() => (setEditError(""), setEditing(true))}>Edit details</Button>}
      />

      <StatGrid cols={3}>
        <KpiCard label="On the shelf" value={onShelf} icon={<BookCopy />} tone="success" hint={`${inStock} copies in stock`} />
        <KpiCard label="On loan" value={onLoan} icon={<BookOpen />} tone="info" />
        <KpiCard label="Times borrowed" value={b.timesBorrowed} icon={<TrendingUp />} />
      </StatGrid>

      {error && <Alert tone="danger" onDismiss={() => setError("")}>{error}</Alert>}
      {notice && <Alert tone="success" onDismiss={() => setNotice("")}>{notice}</Alert>}

      <div className="grid items-start gap-6 lg:grid-cols-[2fr_1fr]">
        <Card padding="none" className="overflow-hidden">
          <div className="px-5 pt-5">
            <CardHeader title="Copies" description="Each copy has its own number stamped inside." icon={<BookCopy />} />
          </div>
          <div className="border-t border-border">
            <DataTable bare label="Copies" columns={columns} data={b.copies} getRowId={(c) => c.id} pageSize={0} defaultSort={{ id: "no", dir: "asc" }} empty={{ title: "No copies yet", description: "Add copies below." }} />
          </div>
          <form
            className="flex flex-wrap items-end gap-2 border-t border-border bg-surface-2 px-5 py-4"
            onSubmit={(e) => {
              e.preventDefault();
              run("add", async () => {
                const res = await api<{ accessionNos: string[] }>(`/library/books/${id}/copies`, { method: "POST", body: { count: Number(count) } });
                return `Added ${res.accessionNos.length}: stamp ${res.accessionNos.join(", ")}.`;
              });
            }}
          >
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-[13px] font-medium text-fg-secondary">More copies</span>
              <Input type="number" min={1} className="h-9 w-24 tabular-nums" value={count} onChange={(e) => setCount(e.target.value)} />
            </label>
            <Button type="submit" variant="secondary" icon={<Plus />} loading={busy === "add"}>Add</Button>
          </form>
        </Card>

        <Card>
          <CardHeader
            title="Details"
            action={<IconButton aria-label="Edit book details" onClick={() => (setEditError(""), setEditing(true))}><Pencil /></IconButton>}
          />
          <DescriptionList columns={1} items={FIELDS.map(([k, label]) => ({ label, value: b[k] || "–" }))} />
        </Card>
      </div>

      <Drawer
        open={editing}
        onOpenChange={setEditing}
        title="Edit book details"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
            <Button type="submit" form="edit-book" icon={<Save />} loading={busy === "save"}>Save</Button>
          </>
        }
      >
        <form id="edit-book" action={save} className="flex flex-col gap-4">
          {editError && <Alert tone="danger">{editError}</Alert>}
          {FIELDS.map(([k, label]) => (
            <Field key={k} label={label} name={k} defaultValue={b[k] ?? ""} required={k === "title"} />
          ))}
        </form>
      </Drawer>
    </div>
  );
}
