# Online fee payments

Parents pay a voucher from **Fee invoices > Pay dues** with JazzCash, Easypaisa or a 1Bill number. A checkout
(`OnlinePayment`) is created for the amount due that day; it only becomes a `Payment` (receipt number, WhatsApp
message, cash book line) after the gateway confirms it:

| Gateway | How the parent pays | How we confirm |
| --- | --- | --- |
| JazzCash | Hosted checkout (HTTP POST page redirection v1.1) | Return post to `/api/payments/return/jazzcash` and IPN at `/api/payments/ipn/jazzcash`, checked with `pp_SecureHash` (HMAC-SHA256 with the integrity salt); Status Inquiry for returns that never arrive |
| Easypaisa | Easypay hosted checkout (`Index.jsf` then `Confirm.jsf`) | Return to `/api/payments/return/easypaisa/done` and IPN at `/api/payments/ipn/easypaisa`, both confirmed through the Inquire Transaction API |
| 1Bill | Parent enters the 1Bill number in any banking or wallet app | 1LINK calls `/api/payments/1bill/bill-inquiry` and `/bill-payment` with the biller username and password headers |

Repeated callbacks are harmless: a paid checkout keeps its one payment. If money arrives for a voucher that was settled
meanwhile, the checkout is held as **Needs review** for the fee office (**Fees > Online payments**) instead of
over-paying the voucher.

## Modes

Set `PAYMENTS_MODE` (see `apps/api/.env.example`):

- `mock` (default outside production): no gateway is called. Pay dues opens a sandbox checkout page in the portal;
  approving it makes the API build the gateway's real response (signed, for JazzCash) and run it through the same
  verification. Use it for demos and testing with the seed data (`pnpm db:seed`, parent login 03001234567).
- `sandbox`: the providers' test environments, with test merchant credentials.
- `live`: production. Each gateway appears only once its credentials are set.
- `off` (default when `NODE_ENV=production`): no online payments, so a server never runs mock mode by accident.

Online payments need the `online_payments` plan feature (Growth and Enterprise).

## Mobile app

In the mobile app a parent taps an unpaid voucher on a child's screen to open **Pay fees**. It uses the same parent
endpoints as the portal. JazzCash and Easypaisa open their hosted checkout in an in-app browser (the signed form is
posted from inside the app); when the gateway sends the parent back to the portal's `/parent/invoices?payment=` page,
the app closes the browser and shows the checkout, which refreshes until the gateway confirms and then shows the
receipt. 1Bill shows the number to pay from a banking app. In mock mode the app shows Approve and Decline buttons in
place of the gateway.

## Daily reconciliation

Every night (02:00 Pakistan time by default, `RECONCILE_AT`; `off` disables it) the API reconciles the previous day for
each school with online payments, and catches up on the two days before if the server was down. It:

1. asks JazzCash (Status Inquiry) and Easypaisa (Inquire Transaction) about checkouts still open from the last 7 days,
   recording payments whose return never reached us and closing ones the gateway says were never paid. 1Bill numbers
   and mock-mode checkouts past their expiry are closed without asking;
2. checks every checkout started that day: paid ones must have a matching receipt, money held for review is listed,
   and a checkout the gateway still can't confirm after its expiry is flagged;
3. when the fee office has uploaded that day's gateway statement (**Fees > Reconciliation > Upload statement**, CSV or
   .xlsx from the merchant portal), matches it line by line both ways: money on the statement with no receipt, receipts
   missing from the statement, and amounts that differ.

What needs a person shows on **Fees > Reconciliation** as an issue. Re-running a day refreshes its issues and clears
those that no longer apply; an issue the fee office resolves (with a note) stays resolved. Statement columns are found
by name (order or transaction reference, amount, date, and status when present; rows whose status is not a success
are skipped). Uploading a statement for days already uploaded replaces those lines, so a corrected report is not
counted twice.

Runs are rows in `PaymentReconciliation`, claimed before work starts, so several API servers never reconcile the same
school and day twice. No Redis or job queue is needed.
