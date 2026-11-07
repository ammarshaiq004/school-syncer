"use client";

import { useState, type FormEvent } from "react";
import { ArrowLeftRight, Banknote, PackagePlus, Plus, SlidersHorizontal, Truck } from "lucide-react";
import { Alert, Badge, Button, DataTable, Drawer, Field, NativeSelect, useToast, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { day, rupees } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import type { Item, PurchaseRow, StockRow, Vendor, Warehouse } from "./types";

const val = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (f: FormData, k: string) => Number(f.get(k) || 0);

/** Runs a form post, then refreshes; shows the server's message when it is refused. */
function useSubmit(done: () => Promise<unknown>, close: () => void, success: string) {
  const toast = useToast();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return {
    error, busy, clear: () => setError(""),
    run: (call: (f: FormData) => Promise<unknown>) => async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = event.currentTarget;
      setError("");
      setBusy(true);
      try {
        await call(new FormData(form));
        toast.success(success);
        form.reset();
        close();
        await done();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
  };
}

function FormDrawer({ open, onOpenChange, title, formId, busy, error, children, submitLabel }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; formId: string; busy: boolean; error: string; children: React.ReactNode; submitLabel: string }) {
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      footer={<><Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" form={formId} loading={busy}>{submitLabel}</Button></>}
    >
      <div className="flex flex-col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        {children}
      </div>
    </Drawer>
  );
}

export function Products({ warehouses, onChange }: { warehouses: Warehouse[]; onChange: () => Promise<void> }) {
  const items = useApi<Item[]>("/pos/items?all=1");
  const categories = useApi<string[]>("/pos/categories");
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const form = useSubmit(async () => { await Promise.all([items.reload(), categories.reload(), onChange()]); }, () => setEditing(null), "Saved");
  const item = editing && editing !== "new" ? editing : null;

  const columns: Column<Item>[] = [
    { id: "name", header: "Product", sortValue: (i) => i.name, cell: (i) => <span className="font-medium text-fg">{i.name}{!i.active && <Badge tone="neutral" className="ms-2">Off</Badge>}</span> },
    { id: "category", header: "Category", sortValue: (i) => i.category, cell: (i) => i.category ?? "–", hideBelow: "md" },
    { id: "cost", header: "Cost", align: "right", sortValue: (i) => i.costPrice, cell: (i) => rupees(i.costPrice), hideBelow: "sm" },
    { id: "price", header: "Price", align: "right", sortValue: (i) => i.salePrice, cell: (i) => rupees(i.salePrice) },
    { id: "onHand", header: "In stock", align: "right", sortValue: (i) => i.onHand, cell: (i) => <span className={i.onHand <= i.reorderLevel ? "text-warning-text" : ""}>{i.onHand} {i.unit}</span> },
    { id: "edit", header: "", align: "right", cell: (i) => <Button size="sm" variant="ghost" onClick={() => { form.clear(); setEditing(i); }}>Edit</Button> },
  ];

  return (
    <>
      <DataTable label="Products" columns={columns} data={items.data} error={items.error} onRetry={items.reload} getRowId={(i) => i.id} getSearchText={(i) => `${i.name} ${i.barcode ?? ""} ${i.category ?? ""} ${i.brand ?? ""}`} searchPlaceholder="Search product, barcode or category"
        toolbarActions={<Button size="sm" icon={<Plus />} onClick={() => { form.clear(); setEditing("new"); }}>Add product</Button>}
        empty={{ title: "No products yet", description: "Add what you sell, then record a purchase to stock it.", icon: <PackagePlus /> }} />
      <FormDrawer open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} title={item ? "Edit product" : "Add a product"} formId="pos-item" busy={form.busy} error={form.error} submitLabel="Save">
        <form id="pos-item" key={item?.id ?? "new"} className="flex flex-col gap-4" onSubmit={form.run((f) => {
          const body = {
            name: val(f, "name"), barcode: val(f, "barcode") || null, category: val(f, "category") || null, brand: val(f, "brand") || null,
            unit: val(f, "unit") || "pcs", costPrice: num(f, "costPrice"), salePrice: num(f, "salePrice"), reorderLevel: num(f, "reorderLevel"),
          };
          return item
            ? api(`/pos/items/${item.id}`, { method: "PATCH", body: { ...body, active: f.get("active") === "on" } })
            : api("/pos/items", { method: "POST", body: { ...body, openingQty: num(f, "openingQty"), warehouseId: val(f, "warehouseId") || undefined } });
        })}>
          <Field label="Name" name="name" required defaultValue={item?.name} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category" name="category" list="pos-categories" defaultValue={item?.category ?? ""} placeholder="Snacks" />
            <datalist id="pos-categories">{categories.data?.map((c) => <option key={c} value={c} />)}</datalist>
            <Field label="Brand" name="brand" defaultValue={item?.brand ?? ""} />
            <Field label="Barcode" name="barcode" defaultValue={item?.barcode ?? ""} />
            <Field label="Unit" name="unit" defaultValue={item?.unit ?? "pcs"} />
            <Field label="Cost price (Rs)" name="costPrice" type="number" min={0} defaultValue={item?.costPrice ?? 0} />
            <Field label="Sale price (Rs)" name="salePrice" type="number" min={0} required defaultValue={item?.salePrice} />
            <Field label="Reorder at" name="reorderLevel" type="number" min={0} defaultValue={item?.reorderLevel ?? 0} />
          </div>
          {item ? (
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={item.active} /> Sold at the counter</label>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Opening stock" name="openingQty" type="number" min={0} defaultValue={0} />
              <label className="flex flex-col gap-1.5 text-[13px] font-medium text-fg-secondary">Store<NativeSelect name="warehouseId" aria-label="Store" options={warehouses.map((w) => ({ value: w.id, label: w.name }))} /></label>
            </div>
          )}
        </form>
      </FormDrawer>
    </>
  );
}

export function Stock({ warehouses, canSetUp, onChange }: { warehouses: Warehouse[]; canSetUp: boolean; onChange: () => Promise<void> }) {
  const [warehouseId, setWarehouseId] = useState("");
  const stock = useApi<StockRow[]>(`/pos/stock${warehouseId ? `?warehouseId=${warehouseId}` : ""}`);
  const [mode, setMode] = useState<"adjust" | "transfer" | "store" | null>(null);
  const items = useApi<Item[]>(mode === "adjust" || mode === "transfer" ? "/pos/items" : null);
  const form = useSubmit(async () => { await Promise.all([stock.reload(), onChange()]); }, () => setMode(null), "Saved");
  const whOptions = warehouses.map((w) => ({ value: w.id, label: w.name }));
  const itemOptions = (items.data ?? []).map((i) => ({ value: i.id, label: i.name }));
  const select = (label: string, name: string, options: { value: string; label: string }[]) => (
    <label className="flex flex-col gap-1.5 text-[13px] font-medium text-fg-secondary">{label}<NativeSelect name={name} aria-label={label} required options={options} placeholder="Choose" /></label>
  );

  const columns: Column<StockRow>[] = [
    { id: "name", header: "Product", sortValue: (s) => s.name, cell: (s) => <span className="font-medium text-fg">{s.name}</span> },
    { id: "warehouse", header: "Store", sortValue: (s) => s.warehouse, cell: (s) => s.warehouse, hideBelow: "sm" },
    { id: "qty", header: "On hand", align: "right", sortValue: (s) => s.qty, cell: (s) => <span className="inline-flex items-center gap-2">{s.low && <Badge tone="warning">Low</Badge>}{s.qty}</span> },
    { id: "value", header: "Value at cost", align: "right", sortValue: (s) => s.value, cell: (s) => rupees(s.value), hideBelow: "md" },
  ];

  return (
    <>
      <DataTable label="Stock" columns={columns} data={stock.data} error={stock.error} onRetry={stock.reload} getRowId={(s) => `${s.itemId}${s.warehouseId}`} getSearchText={(s) => s.name} searchPlaceholder="Search product"
        filters={<NativeSelect aria-label="Store" wrapperClassName="w-44" placeholder="Every store" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} options={whOptions} />}
        toolbarActions={<span className="flex gap-2"><Button size="sm" variant="secondary" icon={<SlidersHorizontal />} onClick={() => { form.clear(); setMode("adjust"); }}>Adjust</Button><Button size="sm" variant="secondary" icon={<ArrowLeftRight />} onClick={() => { form.clear(); setMode("transfer"); }}>Transfer</Button>{canSetUp && <Button size="sm" icon={<Plus />} onClick={() => { form.clear(); setMode("store"); }}>Add store</Button>}</span>}
        empty={{ title: "No stock yet", description: "Record a purchase or add opening stock to a product.", icon: <PackagePlus /> }} />
      <FormDrawer open={mode !== null} onOpenChange={(o) => !o && setMode(null)} title={mode === "adjust" ? "Adjust stock" : mode === "transfer" ? "Move stock between stores" : "Add a store"} formId="pos-stock" busy={form.busy} error={form.error} submitLabel="Save">
        <form id="pos-stock" className="flex flex-col gap-4" onSubmit={form.run((f) =>
          mode === "adjust" ? api("/pos/stock/adjust", { method: "POST", body: { itemId: val(f, "itemId"), warehouseId: val(f, "warehouseId"), change: num(f, "change"), reason: val(f, "reason") } })
          : mode === "transfer" ? api("/pos/stock/transfer", { method: "POST", body: { itemId: val(f, "itemId"), fromId: val(f, "fromId"), toId: val(f, "toId"), qty: num(f, "qty") } })
          : api("/pos/warehouses", { method: "POST", body: { name: val(f, "name") } })
        )}>
          {mode === "adjust" && <>{select("Product", "itemId", itemOptions)}{select("Store", "warehouseId", whOptions)}<Field label="Change (use a minus to remove)" name="change" type="number" required /><Field label="Reason" name="reason" required placeholder="Stock count, breakage, expired" /></>}
          {mode === "transfer" && <>{select("Product", "itemId", itemOptions)}{select("From", "fromId", whOptions)}{select("To", "toId", whOptions)}<Field label="Quantity" name="qty" type="number" min={1} required /></>}
          {mode === "store" && <Field label="Store name" name="name" required placeholder="Canteen counter" />}
        </form>
      </FormDrawer>
    </>
  );
}

export function Purchases({ warehouses, onChange }: { warehouses: Warehouse[]; onChange: () => Promise<void> }) {
  const toast = useToast();
  const purchases = useApi<PurchaseRow[]>("/pos/purchases");
  const vendors = useApi<Vendor[]>("/pos/vendors");
  const items = useApi<Item[]>("/pos/items");
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState([{ itemId: "", qty: 1, unitCost: 0 }]);
  const form = useSubmit(async () => { await Promise.all([purchases.reload(), vendors.reload(), items.reload(), onChange()]); }, () => { setOpen(false); setLines([{ itemId: "", qty: 1, unitCost: 0 }]); }, "Purchase recorded");
  const setLine = (i: number, patch: Partial<(typeof lines)[number]>) => setLines((ls) => ls.map((l, n) => (n === i ? { ...l, ...patch } : l)));

  async function pay(p: PurchaseRow) {
    const answer = window.prompt(`Pay ${p.vendor.name} on ${p.number} (Rs ${p.total - p.paid} owed)`, String(p.total - p.paid));
    const amount = Number(answer);
    if (!answer || !(amount > 0)) return;
    try {
      await api(`/pos/purchases/${p.id}/pay`, { method: "POST", body: { amount } });
      toast.success("Payment recorded");
      await Promise.all([purchases.reload(), vendors.reload(), onChange()]);
    } catch (e) {
      toast.error("Could not record the payment", (e as Error).message);
    }
  }

  const columns: Column<PurchaseRow>[] = [
    { id: "number", header: "No.", sortValue: (p) => p.number, cell: (p) => <span className="font-medium text-fg">{p.number}</span> },
    { id: "on", header: "Date", sortValue: (p) => p.purchasedOn, cell: (p) => day(p.purchasedOn) },
    { id: "vendor", header: "Vendor", sortValue: (p) => p.vendor.name, cell: (p) => p.vendor.name },
    { id: "total", header: "Total", align: "right", sortValue: (p) => p.total, cell: (p) => rupees(p.total) },
    { id: "owed", header: "Owed", align: "right", sortValue: (p) => p.total - p.paid, cell: (p) => (p.total > p.paid ? <Button size="sm" variant="secondary" icon={<Banknote />} onClick={() => pay(p)}>{rupees(p.total - p.paid)}</Button> : <Badge tone="success">Paid</Badge>) },
  ];

  return (
    <>
      <DataTable label="Purchases" columns={columns} data={purchases.data} error={purchases.error} onRetry={purchases.reload} getRowId={(p) => p.id} getSearchText={(p) => `${p.number} ${p.vendor.name}`} searchPlaceholder="Search number or vendor"
        toolbarActions={<Button size="sm" icon={<Plus />} onClick={() => { form.clear(); setOpen(true); }}>New purchase</Button>}
        empty={{ title: "No purchases in the last 90 days", description: "Record stock you buy from a vendor and it is added to the store.", icon: <Truck /> }} />
      <FormDrawer open={open} onOpenChange={setOpen} title="Record a purchase" formId="pos-buy" busy={form.busy} error={form.error} submitLabel="Save purchase">
        <form id="pos-buy" className="flex flex-col gap-4" onSubmit={form.run((f) => api("/pos/purchases", { method: "POST", body: { vendorId: val(f, "vendorId"), warehouseId: val(f, "warehouseId"), paid: num(f, "paid"), lines } }))}>
          <label className="flex flex-col gap-1.5 text-[13px] font-medium text-fg-secondary">Vendor<NativeSelect name="vendorId" aria-label="Vendor" required placeholder="Choose" options={(vendors.data ?? []).filter((v) => v.active).map((v) => ({ value: v.id, label: v.name }))} /></label>
          <label className="flex flex-col gap-1.5 text-[13px] font-medium text-fg-secondary">Into store<NativeSelect name="warehouseId" aria-label="Store" required options={warehouses.map((w) => ({ value: w.id, label: w.name }))} /></label>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_5rem_6rem] gap-2">
              <NativeSelect aria-label="Product" placeholder="Product" value={l.itemId} onChange={(e) => setLine(i, { itemId: e.target.value, unitCost: items.data?.find((x) => x.id === e.target.value)?.costPrice ?? 0 })} options={(items.data ?? []).map((x) => ({ value: x.id, label: x.name }))} />
              <input aria-label="Quantity" type="number" min={1} className="h-9 rounded-lg border border-border bg-surface px-2 text-sm" value={l.qty} onChange={(e) => setLine(i, { qty: Number(e.target.value) })} />
              <input aria-label="Unit cost" type="number" min={0} className="h-9 rounded-lg border border-border bg-surface px-2 text-sm" value={l.unitCost} onChange={(e) => setLine(i, { unitCost: Number(e.target.value) })} />
            </div>
          ))}
          <Button type="button" size="sm" variant="secondary" icon={<Plus />} onClick={() => setLines((ls) => [...ls, { itemId: "", qty: 1, unitCost: 0 }])}>Another product</Button>
          <p className="text-sm text-fg-muted">Total {rupees(lines.reduce((n, l) => n + l.qty * l.unitCost, 0))}</p>
          <Field label="Paid now (Rs)" name="paid" type="number" min={0} defaultValue={0} />
        </form>
      </FormDrawer>
    </>
  );
}

export function Vendors({ onChange }: { onChange: () => Promise<void> }) {
  const vendors = useApi<Vendor[]>("/pos/vendors");
  const [editing, setEditing] = useState<Vendor | "new" | null>(null);
  const form = useSubmit(async () => { await Promise.all([vendors.reload(), onChange()]); }, () => setEditing(null), "Saved");
  const vendor = editing && editing !== "new" ? editing : null;
  const columns: Column<Vendor>[] = [
    { id: "name", header: "Vendor", sortValue: (v) => v.name, cell: (v) => <span className="font-medium text-fg">{v.name}{!v.active && <Badge tone="neutral" className="ms-2">Off</Badge>}</span> },
    { id: "phone", header: "Phone", cell: (v) => v.phone ?? "–", hideBelow: "sm" },
    { id: "owed", header: "We owe", align: "right", sortValue: (v) => v.owed, cell: (v) => rupees(v.owed) },
    { id: "edit", header: "", align: "right", cell: (v) => <Button size="sm" variant="ghost" onClick={() => { form.clear(); setEditing(v); }}>Edit</Button> },
  ];
  return (
    <>
      <DataTable label="Vendors" columns={columns} data={vendors.data} error={vendors.error} onRetry={vendors.reload} getRowId={(v) => v.id} getSearchText={(v) => `${v.name} ${v.phone ?? ""}`} searchPlaceholder="Search vendors"
        toolbarActions={<Button size="sm" icon={<Plus />} onClick={() => { form.clear(); setEditing("new"); }}>Add vendor</Button>}
        empty={{ title: "No vendors yet", description: "Add the suppliers you buy from.", icon: <Truck /> }} />
      <FormDrawer open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} title={vendor ? "Edit vendor" : "Add a vendor"} formId="pos-vendor" busy={form.busy} error={form.error} submitLabel="Save">
        <form id="pos-vendor" key={vendor?.id ?? "new"} className="flex flex-col gap-4" onSubmit={form.run((f) => {
          const body = { name: val(f, "name"), phone: val(f, "phone") || null, address: val(f, "address") || null, notes: val(f, "notes") || null };
          return vendor ? api(`/pos/vendors/${vendor.id}`, { method: "PATCH", body: { ...body, active: f.get("active") === "on" } }) : api("/pos/vendors", { method: "POST", body });
        })}>
          <Field label="Name" name="name" required defaultValue={vendor?.name} />
          <Field label="Phone" name="phone" defaultValue={vendor?.phone ?? ""} />
          <Field label="Address" name="address" defaultValue={vendor?.address ?? ""} />
          <Field label="Notes" name="notes" defaultValue={vendor?.notes ?? ""} />
          {vendor && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={vendor.active} /> Still buying from them</label>}
        </form>
      </FormDrawer>
    </>
  );
}
