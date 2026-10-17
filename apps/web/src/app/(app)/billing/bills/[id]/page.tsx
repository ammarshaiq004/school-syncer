"use client";

import { useParams } from "next/navigation";
import { PlatformBillPage } from "@/components/billing/platform-documents";
import type { BillDocument } from "@/lib/platform-billing";
import { useApi } from "@/lib/use-api";

/** The school's copy of a SchoolSyncer bill, to print or save as PDF. */
export default function SchoolBillPage() {
  const { id } = useParams<{ id: string }>();
  const state = useApi<BillDocument>(`/subscription/invoices/${id}`);
  return (
    <PlatformBillPage
      state={state}
      crumbs={[{ label: "Plan and billing", href: "/billing" }]}
      receiptHref={(paymentId) => `/billing/receipts/${paymentId}`}
    />
  );
}
