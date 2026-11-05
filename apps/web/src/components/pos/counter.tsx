"use client";

import { useState } from "react";
import { Banknote, Minus, Plus, Receipt, ShoppingCart, Trash2, Undo2, UserRound } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, NativeSelect, SearchInput, SegmentedControl, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { rupees } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import type { Customer, Item, SaleRow, Warehouse } from "./types";

interface CartLine { item: Item; qty: number }

/** The counter: tap products into a cart, take cash or put it on a student's account. */
export function Counter({ warehouses, onChange }: { warehouses: Warehouse[]; onChange: () => Promise<void> }) {
  const toast = useToast();
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const items = useApi<Item[]>(`/pos/items?warehouseId=${warehouseId}${search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ""}`);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState(0);
  const [payment, setPayment] = useState<"CASH" | "ON_ACCOUNT">("CASH");
  const [studentSearch, setStudentSearch] = useState("");
  const [student, setStudent] = useState<Customer | null>(null);
  const customers = useApi<Customer[]>(payment === "ON_ACCOUNT" && !student && studentSearch.trim().length >= 2 ? `/pos/customers?search=${encodeURIComponent(studentSearch.trim())}` : null);
  const sales = useApi<SaleRow[]>(`/pos/sales?from=${new Date().toLocaleDateString("en-CA")}`);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const subtotal = cart.reduce((n, l) => n + l.qty * l.item.salePrice, 0);
  const total = Math.max(0, subtotal - discount);

  const add = (item: Item) =>
    setCart((c) => (c.some((l) => l.item.id === item.id) ? c.map((l) => (l.item.id === item.id ? { ...l, qty: l.qty + 1 } : l)) : [...c, { item, qty: 1 }]));
  const change = (id: string, by: number) =>
    setCart((c) => c.flatMap((l) => (l.item.id !== id ? [l] : l.qty + by < 1 ? [] : [{ ...l, qty: l.qty + by }])));

  async function sell() {
    setError("");
    setBusy(true);
    try {
      const sale = await api<SaleRow>("/pos/sales", {
        method: "POST",
        body: {
          warehouseId,
          lines: cart.map((l) => ({ itemId: l.item.id, qty: l.qty })),
          discount,
          payment,
          ...(payment === "ON_ACCOUNT" && student ? { studentId: student.id } : {}),
        },
      });
      toast.success(`Sale ${sale.number}`, `${rupees(sale.total)} ${payment === "CASH" ? "in cash" : `on ${student?.name}'s account`}.`);
      setCart([]);
      setDiscount(0);
      setStudent(null);
      setStudentSearch("");
      await Promise.all([sales.reload(), items.reload(), onChange()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function voidSale(sale: SaleRow) {
    const reason = window.prompt(`Why is ${sale.number} being cancelled?`);
    if (!reason || reason.trim().length < 2) return;
    try {
      await api(`/pos/sales/${sale.id}/void`, { method: "POST", body: { reason: reason.trim() } });
      toast.success(`${sale.number} cancelled`, "The goods are back in stock.");
      await Promise.all([sales.reload(), items.reload(), onChange()]);
    } catch (e) {
      toast.error("Could not cancel", (e as Error).message);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-3">
          <NativeSelect aria-label="Store" wrapperClassName="w-48" value={warehouseId} onChange={(e) => { setWarehouseId(e.target.value); setCart([]); }} options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
          <SearchInput wrapperClassName="min-w-60 flex-1" placeholder="Search product or scan barcode" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          {(items.data ?? []).map((i) => (
            <button key={i.id} type="button" disabled={i.onHand < 1} onClick={() => add(i)} className="rounded-xl border border-border bg-surface p-3 text-left transition hover:border-border-strong hover:shadow-raised focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring disabled:opacity-50">
              <span className="block truncate text-sm font-medium text-fg">{i.name}</span>
              <span className="block text-sm text-fg-muted">{rupees(i.salePrice)}</span>
              <span className={i.onHand <= i.reorderLevel ? "text-xs text-warning-text" : "text-xs text-fg-muted"}>{i.onHand} {i.unit} left</span>
            </button>
          ))}
        </div>
        {items.data?.length === 0 && <EmptyState compact title="No products found" description="Add products on the Products tab." icon={<ShoppingCart />} />}
      </div>

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader title="Cart" icon={<ShoppingCart />} />
          {cart.length === 0 ? (
            <p className="text-sm text-fg-muted">Tap a product to add it.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {cart.map((l) => (
                <li key={l.item.id} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{l.item.name}</span>
                  <Button size="sm" variant="secondary" aria-label={`Fewer ${l.item.name}`} icon={l.qty === 1 ? <Trash2 /> : <Minus />} onClick={() => change(l.item.id, -1)} />
                  <span className="w-6 text-center tabular-nums">{l.qty}</span>
                  <Button size="sm" variant="secondary" aria-label={`More ${l.item.name}`} icon={<Plus />} onClick={() => change(l.item.id, 1)} />
                  <span className="w-20 text-right tabular-nums">{rupees(l.qty * l.item.salePrice)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4">
            <Field label="Discount (Rs)" type="number" min={0} value={discount} onChange={(e) => setDiscount(Number(e.target.value) || 0)} />
            <SegmentedControl aria-label="Payment" value={payment} onChange={(v) => { setPayment(v); setStudent(null); }} options={[{ value: "CASH", label: "Cash", icon: <Banknote /> }, { value: "ON_ACCOUNT", label: "On account", icon: <UserRound /> }]} />
            {payment === "ON_ACCOUNT" &&
              (student ? (
                <div className="flex items-center justify-between rounded-lg bg-surface-2 p-2 text-sm">
                  <span>{student.name} <span className="text-fg-muted">{student.class}</span></span>
                  <Button size="sm" variant="ghost" onClick={() => setStudent(null)}>Change</Button>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <SearchInput placeholder="Find the student" value={studentSearch} onChange={(e) => setStudentSearch(e.target.value)} />
                  {customers.data?.map((c) => (
                    <button key={c.id} type="button" onClick={() => setStudent(c)} className="flex items-center justify-between rounded-lg border border-border p-2 text-left text-sm hover:bg-surface-2">
                      <span>{c.name} <span className="text-fg-muted">{c.class ?? c.admissionNo}</span></span>
                      {c.onAccount > 0 && <Badge tone="warning">owes {rupees(c.onAccount)}</Badge>}
                    </button>
                  ))}
                </div>
              ))}
            <div className="flex items-baseline justify-between text-lg font-semibold"><span>Total</span><span className="tabular-nums">{rupees(total)}</span></div>
            {error && <Alert tone="danger">{error}</Alert>}
            <Button icon={<Receipt />} loading={busy} disabled={!cart.length || !warehouseId || (payment === "ON_ACCOUNT" && !student)} onClick={sell}>Complete sale</Button>
          </div>
        </Card>

        <Card>
          <CardHeader title="Today's sales" icon={<Receipt />} />
          <ul className="flex flex-col gap-2 text-sm">
            {(sales.data ?? []).slice(0, 8).map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2">
                <span className={s.voidedAt ? "text-fg-muted line-through" : ""}>{s.number} · {s.studentName ?? "Walk-in"}</span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums">{rupees(s.total)}</span>
                  {!s.voidedAt && !s.settledAt && <Button size="sm" variant="ghost" aria-label={`Cancel ${s.number}`} icon={<Undo2 />} onClick={() => voidSale(s)} />}
                </span>
              </li>
            ))}
            {sales.data?.length === 0 && <li className="text-fg-muted">No sales yet today.</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}
