# Online fee payments

Parents pay a voucher from **Fee invoices > Pay dues** with JazzCash, Easypaisa or a 1Bill number. A checkout
(`OnlinePayment`) is created for the amount due that day; it only becomes a `Payment` (receipt number, WhatsApp
message, cash book line) after the gateway confirms it:

| Gateway | How the parent pays | How we confirm |
| --- | --- | --- |
| JazzCash | Hosted checkout (HTTP POST page redirection v1.1) | Return post to `/api/payments/return/jazzcash`, checked with `pp_SecureHash` (HMAC-SHA256 with the integrity salt) |
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
