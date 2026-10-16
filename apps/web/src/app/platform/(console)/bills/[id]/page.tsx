"use client";

import { useParams } from "next/navigation";
import { PlatformBillPage } from "@/components/billing/platform-documents";
import type { BillDocument } from "@/lib/platform-billing";
import { usePlatformApi } from "@/lib/use-api";

/** A SchoolSyncer bill to print or save as PDF for the school. */
export default function ConsoleBillPage() {
  const { id } = useParams<{ id: string }>();
  const state = usePlatformApi<BillDocument>(`/invoices/${id}`);
  const school = state.data?.invoice.school;
  return (
    <PlatformBillPage
      state={state}
      crumbs={[
        { label: "Bills", href: "/platform/invoices" },
        ...(school ? [{ label: school.name, href: `/platform/schools/${school.id}` }] : []),
      ]}
      receiptHref={(paymentId) => `/platform/receipts/${paymentId}`}
    />
  );
}
