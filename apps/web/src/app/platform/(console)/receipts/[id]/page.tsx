"use client";

import { useParams } from "next/navigation";
import { PlatformReceiptPage } from "@/components/billing/platform-documents";
import type { ReceiptDocument } from "@/lib/platform-billing";
import { usePlatformApi } from "@/lib/use-api";

/** A receipt for money a school paid SchoolSyncer, to print or save as PDF. */
export default function ConsoleReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const state = usePlatformApi<ReceiptDocument>(`/payments/${id}`);
  const school = state.data?.payment.school;
  return (
    <PlatformReceiptPage
      state={state}
      crumbs={[
        { label: "Payments", href: "/platform/payments" },
        ...(school ? [{ label: school.name, href: `/platform/schools/${school.id}` }] : []),
      ]}
      billHref={(invoiceId) => `/platform/bills/${invoiceId}`}
    />
  );
}
