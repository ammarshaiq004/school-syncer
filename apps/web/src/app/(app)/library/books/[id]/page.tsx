"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Badge, Button, Card, ErrorText, Field, Notice, rowClass, tableClass } from "@/components/ui";
import { api } from "@/lib/api";
import { day } from "@/lib/format";
import { daysOverdue, type Loan } from "@/lib/library";
import { useApi } from "@/lib/use-api";

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
  copies: { id: string; accessionNo: string; status: string; addedOn: string; campus: { name: string } | null; loan: Loan | null }[];
}

const STATUS_TONE: Record<string, "green" | "blue" | "red" | "gray"> = { AVAILABLE: "green", ON_LOAN: "blue", LOST: "red", WITHDRAWN: "gray" };
const STATUS_LABEL: Record<string, string> = { AVAILABLE: "on the shelf", ON_LOAN: "on loan", LOST: "lost", WITHDRAWN: "withdrawn" };
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
  const book = useApi<BookDetail>(`/library/books/${id}`);
  const [editing, setEditing] = useState(false);
  const [count, setCount] = useState("1");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const b = book.data;

  async function run(action: () => Promise<string>) {
    setError("");
    setNotice("");
    try {
      setNotice(await action());
      await book.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function save(form: FormData) {
    await run(async () => {
      await api(`/library/books/${id}`, {
        method: "PATCH",
        body: Object.fromEntries(FIELDS.map(([k]) => [k, (form.get(k) as string) || (k === "title" || k === "language" ? undefined : null)])),
      });
      setEditing(false);
      return "Saved.";
    });
  }

  if (!b) return <ErrorText>{book.error}</ErrorText>;
  const onShelf = b.copies.filter((c) => c.status === "AVAILABLE").length;

  return (
    <div className="flex flex-col gap-6">
      <Link href="/library" className="text-sm text-brand">← Library</Link>
      <div>
        <h1 className="text-2xl font-semibold">{b.title}</h1>
        <p className="text-sm opacity-70">
          {[b.author, b.category, b.language !== "English" && b.language, b.shelf && `shelf ${b.shelf}`].filter(Boolean).join(" · ")}
        </p>
        <p className="mt-1 text-sm">{onShelf} of {b.copies.filter((c) => c.status !== "WITHDRAWN").length} copies on the shelf · borrowed {b.timesBorrowed} times</p>
      </div>
      <ErrorText>{error}</ErrorText>
      <Notice>{notice}</Notice>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card className="overflow-x-auto">
          <h2 className="mb-3 font-semibold">Copies</h2>
          <table className={tableClass}>
            <thead className="opacity-60"><tr><th className="py-2">No.</th><th>Status</th><th>With</th><th>Due</th><th /></tr></thead>
            <tbody>
              {b.copies.map((c) => (
                <tr key={c.id} className={rowClass}>
                  <td className="py-2 font-medium">{c.accessionNo}</td>
                  <td><Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge></td>
                  <td>
                    {c.loan ? (
                      <>
                        {c.loan.borrower.kind === "student" ? <Link className="text-brand" href={`/students/${c.loan.borrower.id}`}>{c.loan.borrower.name}</Link> : c.loan.borrower.name}
                        <div className="text-xs opacity-60">{c.loan.borrower.detail}</div>
                      </>
                    ) : "–"}
                  </td>
                  <td>
                    {c.loan ? day(c.loan.dueOn) : "–"}
                    {c.loan?.overdue && <div className="text-xs text-red-600">{daysOverdue(c.loan.dueOn)} days late</div>}
                  </td>
                  <td className="text-right">
                    {c.status === "AVAILABLE" && (
                      <button className="text-sm opacity-60 hover:opacity-100" onClick={() => run(async () => (await api(`/library/copies/${c.id}`, { method: "PATCH", body: { status: "WITHDRAWN" } }), `Copy ${c.accessionNo} withdrawn.`))}>
                        Withdraw
                      </button>
                    )}
                    {(c.status === "LOST" || c.status === "WITHDRAWN") && (
                      <button className="text-sm text-brand" onClick={() => run(async () => (await api(`/library/copies/${c.id}`, { method: "PATCH", body: { status: "AVAILABLE" } }), `Copy ${c.accessionNo} is back on the shelf.`))}>
                        Back on shelf
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4 flex items-end gap-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">More copies</span>
              <input type="number" min={1} className="w-24 rounded-lg border border-black/15 bg-transparent px-3 py-2 dark:border-white/20" value={count} onChange={(e) => setCount(e.target.value)} />
            </label>
            <Button
              variant="ghost"
              onClick={() =>
                run(async () => {
                  const res = await api<{ accessionNos: string[] }>(`/library/books/${id}/copies`, { method: "POST", body: { count: Number(count) } });
                  return `Added ${res.accessionNos.length}: stamp ${res.accessionNos.join(", ")}.`;
                })
              }
            >
              Add
            </Button>
          </div>
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Details</h2>
            {!editing && <button className="text-sm text-brand" onClick={() => setEditing(true)}>Edit</button>}
          </div>
          {editing ? (
            <form action={save} className="flex flex-col gap-3">
              {FIELDS.map(([k, label]) => (
                <Field key={k} label={label} name={k} defaultValue={b[k] ?? ""} required={k === "title"} />
              ))}
              <div className="flex gap-2">
                <Button type="submit">Save</Button>
                <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
              </div>
            </form>
          ) : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              {FIELDS.map(([k, label]) => (
                <div key={k} className="contents">
                  <dt className="opacity-60">{label}</dt>
                  <dd>{b[k] || "–"}</dd>
                </div>
              ))}
            </dl>
          )}
        </Card>
      </div>
    </div>
  );
}
