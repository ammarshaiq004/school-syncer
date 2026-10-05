"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { Alert, buttonClass } from "@/components/kit";
import { rupees } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { PROVIDER_LABEL, type CheckoutDetail } from "./online-payment";

/**
 * The outcome of an online payment, shown where the gateway sends the parent
 * back (?payment=<checkout id>, or ?payment=unverified when the return could
 * not be checked). Waits a while for a payment the gateway has not confirmed yet.
 */
export function CheckoutResult({ onSettled }: { onSettled?: () => void }) {
  return (
    <Suspense>
      <CheckoutResultInner onSettled={onSettled} />
    </Suspense>
  );
}

const POLL_MS = 4000;
/** About three minutes of checking before leaving it to the gateway's notification. */
const MAX_POLLS = 45;

function CheckoutResultInner({ onSettled }: { onSettled?: () => void }) {
  const id = useSearchParams().get("payment");
  const checkoutId = id && id !== "unverified" ? id : null;
  const res = useApi<CheckoutDetail>(checkoutId ? `/parent/payments/${checkoutId}` : null);
  const c = res.data;
  const [polls, setPolls] = useState(0);
  const settled = useRef(false);
  const { reload } = res;

  const waiting = c?.status === "PENDING" && !c.expired && polls < MAX_POLLS;
  useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(() => {
      setPolls((n) => n + 1);
      void reload();
    }, POLL_MS);
    return () => clearTimeout(t);
  }, [waiting, reload, c]);

  useEffect(() => {
    if (c?.status === "PAID" && !settled.current) {
      settled.current = true;
      onSettled?.();
    }
  }, [c?.status, onSettled]);

  if (id === "unverified") {
    return (
      <Alert tone="warning" title="We could not confirm that payment" className="print:hidden">
        If money left your account, the voucher will show as paid once the gateway confirms it. Otherwise, please try again.
      </Alert>
    );
  }
  if (!c) return null;
  const via = PROVIDER_LABEL[c.provider];
  if (c.status === "PAID") {
    return (
      <Alert
        tone="success"
        title={`Payment received: ${rupees(c.amount)} by ${via}`}
        className="print:hidden"
        action={
          <Link href={`/parent/payments/${c.id}`} className={buttonClass("secondary", "sm")}>
            View receipt
          </Link>
        }
      >
        Receipt {c.receipt?.receiptNo ?? c.receiptNo}. The school has your payment and the voucher is updated.
      </Alert>
    );
  }
  if (c.status === "FAILED") {
    return (
      <Alert tone="danger" title={`The ${via} payment was not completed`} className="print:hidden">
        {c.message ? `${c.message} ` : ""}No money was taken for it. You can try again with Pay dues.
      </Alert>
    );
  }
  if (c.status === "REVIEW") {
    return (
      <Alert tone="info" title="Your payment reached us and the school will apply it" className="print:hidden">
        {via} confirmed {rupees(c.amount)}, but the voucher had changed in the meantime, so the fee office will check it
        and adjust or refund. Reference {c.providerRef ?? c.txnRef}.
      </Alert>
    );
  }
  return (
    <Alert tone="warning" title={c.expired ? "This payment timed out" : `Waiting for ${via} to confirm`} className="print:hidden">
      {c.expired
        ? "No confirmation came from the gateway. If money left your account, it will show here once confirmed."
        : "This usually takes a few seconds. Keep this page open."}
    </Alert>
  );
}
