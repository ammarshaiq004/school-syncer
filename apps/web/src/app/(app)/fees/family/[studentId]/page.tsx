"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Banknote, Printer, Users } from "lucide-react";
import { Button, Card, CardHeader, Dialog, EmptyState, ErrorState, PageHeader, SelectField, Skeleton, TextField, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { day, rupees } from "@/lib/format";
import { can, useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";

interface FamilyVoucher {
  school: { name: string; city: string | null; phone: string | null };
  family: { children: { id: string; name: string; admissionNo: string }[]; guardians: { name: string; phone: string }[] };
  invoices: {
    id: string;
    voucherNo: string;
    period: string;
    dueDate: string;
    paid: number;
    balance: number;
    student: { id: string; name: string; admissionNo: string };
    lines: { description: string; amount: number }[];
  }[];
  balance: number;
}

const METHODS = [["CASH", "Cash"], ["BANK", "Bank"], ["JAZZCASH", "JazzCash"], ["EASYPAISA", "Easypaisa"], ["ONEBILL", "1Bill"], ["CARD", "Card"]];

/** One voucher for the whole family: every child's open vouchers, and one payment for all of them. */
export default function FamilyVoucherPage() {
  const { studentId } = useParams<{ studentId: string }>();
  const toast = useToast();
  const user = useSession();
  const canManage = can(user, "fees", "manage") && user.plan?.access !== "read_only";
  const voucher = useApi<FamilyVoucher>(`/fees/families/${studentId}`);
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const v = voucher.data;

  async function pay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    setSaving(true);
    try {
      const res = await api<{ receipts: { receiptNo: string }[] }>(`/fees/families/${studentId}/payments`, {
        method: "POST",
        body: { amount: Number(f.get("amount")), method: f.get("method"), reference: f.get("reference") || undefined, idempotencyKey: key },
      });
      toast.success("Family payment recorded", `${res.receipts.length} receipt${res.receipts.length === 1 ? "" : "s"}: ${res.receipts.map((r) => r.receiptNo).join(", ")}.`);
      setOpen(false);
      setError("");
      await voucher.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const crumbs = [{ label: "Fees", href: "/fees" }, { label: "Family voucher" }];
  if (!v) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Family voucher" breadcrumbs={crumbs} />
        {voucher.error ? (
          <Card padding="none">
            <ErrorState message={voucher.error} onRetry={voucher.reload} />
          </Card>
        ) : (
          <Card>
            <Skeleton className="h-5 w-48" />
            <Skeleton className="mt-4 h-32 w-full" />
          </Card>
        )}
      </div>
    );
  }
  const guardians = v.family.guardians.map((g) => g.name).join(", ") || "Family";
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Family voucher: ${guardians}`}
        description={v.family.children.map((c) => c.name).join(", ")}
        breadcrumbs={crumbs}
        actions={
          <>
            <Button variant="secondary" icon={<Printer />} onClick={() => window.print()}>
              Print
            </Button>
            {canManage && v.balance > 0 && (
              <Button
                icon={<Banknote />}
                onClick={() => {
                  setError("");
                  setKey(crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
                  setOpen(true);
                }}
              >
                Record family payment
              </Button>
            )}
          </>
        }
      />
      <div className="hidden print:block">
        <h1 className="font-display text-xl font-semibold text-black">{v.school.name}</h1>
        <p className="text-sm text-black">Family fee voucher, printed {day(new Date())}. Guardians: {guardians}.</p>
      </div>
      {v.invoices.length === 0 ? (
        <Card padding="none">
          <EmptyState icon={<Users />} title="This family owes nothing" description="Every voucher for these children is paid." />
        </Card>
      ) : (
        <>
          {v.invoices.map((i) => (
            <Card key={i.id}>
              <CardHeader
                title={`${i.student.name} (${i.student.admissionNo})`}
                description={`${i.period}, voucher ${i.voucherNo}, due ${day(i.dueDate)}`}
                action={
                  <Link className="text-sm text-brand hover:underline print:hidden" href={`/fees/invoices/${i.id}`}>
                    Open voucher
                  </Link>
                }
              />
              <table className="w-full text-sm tabular-nums">
                <tbody>
                  {i.lines.map((l, n) => (
                    <tr key={n} className="border-t border-border">
                      <td className="py-1.5">{l.description}</td>
                      <td className="py-1.5 text-right">{rupees(l.amount)}</td>
                    </tr>
                  ))}
                  {i.paid > 0 && (
                    <tr className="border-t border-border text-fg-muted">
                      <td className="py-1.5">Paid so far</td>
                      <td className="py-1.5 text-right">{rupees(-i.paid)}</td>
                    </tr>
                  )}
                  <tr className="border-t-2 border-border font-semibold text-fg">
                    <td className="py-1.5">Balance on this voucher</td>
                    <td className="py-1.5 text-right">{rupees(i.balance)}</td>
                  </tr>
                </tbody>
              </table>
            </Card>
          ))}
          <Card>
            <div className="flex items-center justify-between text-base font-semibold text-fg">
              <span>Total for the family</span>
              <span className="tabular-nums">{rupees(v.balance)}</span>
            </div>
          </Card>
        </>
      )}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Record family payment"
        description={`The family owes ${rupees(v.balance)}. The payment goes to the earliest due voucher first.`}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="family-payment" loading={saving} icon={<Banknote />}>
              Save payment
            </Button>
          </>
        }
      >
        <form id="family-payment" onSubmit={pay} className="grid gap-4 sm:grid-cols-2">
          <TextField label="Amount (Rs)" name="amount" type="number" min={1} max={v.balance} defaultValue={v.balance} required inputMode="numeric" hint={`At most ${rupees(v.balance)}`} />
          <SelectField label="Method" name="method" options={METHODS.map(([value, label]) => ({ value, label }))} />
          <TextField label="Reference" name="reference" placeholder="Slip or transaction number" wrapperClassName="sm:col-span-2" />
          {error && <p className="text-sm text-danger-text sm:col-span-2">{error}</p>}
        </form>
      </Dialog>
    </div>
  );
}
