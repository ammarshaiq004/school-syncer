"use client";

import { useParams } from "next/navigation";
import { PlatformReceiptPage } from "@/components/billing/platform-documents";
import type { ReceiptDocument } from "@/lib/platform-billing";
import { useApi } from "@/lib/use-api";

/** The school's receipt for a payment to SchoolSyncer, to print or save as PDF. */
export default function SchoolReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const state = useApi<ReceiptDocument>(`/subscription/payments/${id}`);
  return (
    <PlatformReceiptPage
      state={state}
      crumbs={[{ label: "Plan and billing", href: "/billing" }]}
      billHref={(invoiceId) => `/billing/bills/${invoiceId}`}
    />
  );
}
