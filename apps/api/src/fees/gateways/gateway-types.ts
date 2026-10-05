/** What the parent's browser does next to pay at a gateway. */
export type CheckoutAction =
  /** Post these fields to the gateway's hosted checkout page (JazzCash, Easypaisa). */
  | { kind: 'form'; url: string; fields: Record<string, string> }
  /** Pay from any banking or wallet app with this 1Bill consumer number. */
  | { kind: 'onebill'; consumerNumber: string }
  /** Mock mode: open the portal's sandbox checkout page. */
  | { kind: 'mock' };

/** A gateway's verified answer about one checkout. */
export interface GatewayResult {
  /** Our reference for the checkout (pp_TxnRefNo, orderRefNum or the 1Bill consumer number). */
  txnRef: string;
  outcome: 'PAID' | 'FAILED' | 'PENDING';
  /** Whole rupees the gateway says it collected. */
  amount?: number;
  /** The gateway's own transaction id. */
  providerRef?: string;
  responseCode?: string;
  message?: string;
}

/** Turns a gateway amount in paisa ("150000" or 150000) into whole rupees, or undefined. */
export function rupeesFromPaisa(value: string | number | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n / 100 : undefined;
}
