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
- `off` (default when `NODE_ENV=production`): no online payments. With `NODE_ENV=production` the API refuses to start
  in mock mode, since mock lets parents approve their own payments, and the mock approval route answers 404 in every
  other mode. Sandbox and live also need `PAYMENTS_SECRET_KEY`.

Online payments need the `online_payments` plan feature (Growth and Enterprise).

## Mobile app

In the mobile app a parent taps an unpaid voucher on a child's screen to open **Pay fees**. It uses the same parent
endpoints as the portal. JazzCash and Easypaisa open their hosted checkout in an in-app browser (the signed form is
posted from inside the app); when the gateway sends the parent back to the portal's `/parent/invoices?payment=` page,
the app closes the browser and shows the checkout, which refreshes until the gateway confirms and then shows the
receipt. 1Bill shows the number to pay from a banking app. In mock mode the app shows Approve and Decline buttons in
place of the gateway.

## Merchant accounts

A gateway takes payments for a school with either:

- **the school's own merchant account**, entered by the owner or an admin in **System settings > Online payments**.
  Money settles straight to the school. Secrets (passwords, integrity salt, hash key) are encrypted with AES-256-GCM
  using `PAYMENTS_SECRET_KEY` and never sent back to the browser; leaving a secret box empty keeps the saved value; or
- **the server's account** from the environment (`JAZZCASH_*`, `EASYPAISA_*`, `ONEBILL_*`), used for every school that
  has no account of its own for that gateway. Leave these empty if every school must bring its own.

A school can switch a gateway off, which hides it from parents even when the server has an account. Callbacks find the
right account from the checkout: JazzCash posts are checked with that account's integrity salt, Easypaisa inquiries
use that store's credentials, and 1LINK calls must carry the credentials of the biller whose prefix starts the
consumer number. Each school needs its own 1Bill biller prefix.

## Going live

1. Set `PAYMENTS_SECRET_KEY` (32+ characters; `openssl rand -hex 32`). Keep it safe: changing it makes saved school
   secrets unreadable, and those gateways switch off until they are entered again.
2. Host the API at a public https address and set `API_PUBLIC_URL` and `WEB_PUBLIC_URL`. Gateways cannot reach
   localhost. The API logs what is still missing at start-up, and Settings > Online payments shows it to schools.
3. Run with `PAYMENTS_MODE=sandbox` and the providers' test credentials; pay one voucher with each gateway.
4. Switch to `PAYMENTS_MODE=live` with the live credentials. Give each gateway the addresses shown under
   **Addresses to give ...** in Settings > Online payments (return, IPN and 1LINK bill inquiry/payment URLs).

Override hosts only if a provider gives you different ones: `JAZZCASH_CHECKOUT_URL`, `JAZZCASH_INQUIRY_URL`,
`EASYPAISA_BASE_URL`.

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
