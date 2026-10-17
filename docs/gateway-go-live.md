# Gateway go-live runbook

How to take JazzCash, Easypaisa and 1Bill from "credentials just arrived" to "parents can pay", one gateway at a
time. Each gateway goes through the same steps: ask the provider, register our addresses, fill the credentials, test
the connection, pay one sandbox voucher, pay one small live voucher, and know how to roll back. How payments work is
described in [online-payments.md](online-payments.md).

The tools used below:

- **Test connection**: one harmless call to the gateway with the saved credentials. No money moves. It is in the
  console under **Payment gateways** for the server's account, and in **System settings > Online payments** for a
  school's own account (owner or school-wide admin only). It shows pass or fail, the provider's code and a plain
  hint. It never shows or logs secrets, it is limited to 10 checks per account holder every 10 minutes, and each
  check is in the audit log (`payments.gateway.check` in the console, `payments.account.check` in the school's log).
- **Small live test**: console only, **Payment gateways > Small live test**. It makes a test voucher (Rs 10 by
  default, at most Rs 100) for the school's "Gateway Test" student (admission number `GATEWAY-TEST`, status Left, so
  it is not in class lists or counts), opens the real gateway checkout, shows every return, IPN and 1LINK call as it
  arrives, and shows the receipt. **Reverse test payment** then reverses the payment with the fee office's own
  reversal and voids the voucher, so the school's totals do not change. Every run is kept in the history with the
  gateway, mode, amount, result, timings and whether a callback was seen.
- **Contract tests**: `apps/api/src/fees/gateways/contracts.spec.ts` pins field names, signatures and response codes
  against the sample payloads in `apps/api/src/fees/gateways/samples/`. If the provider's integration guide differs
  from a sample, fix the sample and the code together, and run `pnpm --filter api test`.

## Before any gateway

1. Host the API at a public https address. Set `API_PUBLIC_URL` (no trailing `/api`) and `WEB_PUBLIC_URL`. Gateways
   cannot reach localhost or a private network.
2. Set `PAYMENTS_SECRET_KEY` (`openssl rand -hex 32`) and store it in the password manager. Changing it later makes
   saved school secrets unreadable.
3. Set `PAYMENTS_MODE=sandbox` and restart. The console's **Payment gateways** page lists anything still missing
   under "Not ready for real payments yet". It must be empty before you go on.
4. Pick a school for the tests (your own demo school is best). It needs at least one campus and a plan with
   `online_payments`.

Decide per gateway whose account takes the money: the **server's account** (env vars, for every school without its
own) or the **school's own account** (System settings > Online payments). The steps are the same; only where you type
the credentials differs.

## JazzCash

**Ask JazzCash for** (sandbox first, then live; the two have different credentials):

- Merchant ID (starts with `MC`), password and integrity salt for **HTTP POST page redirection v1.1**.
- Access to the **Transaction Status Inquiry** API for the same merchant.
- IPN enabled for the merchant.
- Their response code sheet, to compare with `apps/api/src/fees/gateways/samples/jazzcash.json`.
- Whether they allow-list server IP addresses; if so, give them the API server's outbound IP.

**Register with JazzCash** (exact addresses are on the console's JazzCash card under "Addresses to register"):

| What | Address |
| --- | --- |
| Return URL | `https://<API_PUBLIC_URL>/api/payments/return/jazzcash` |
| IPN URL | `https://<API_PUBLIC_URL>/api/payments/ipn/jazzcash` |

**Fill in**: `JAZZCASH_MERCHANT_ID`, `JAZZCASH_PASSWORD`, `JAZZCASH_INTEGRITY_SALT` (server account), or the JazzCash
card in the school's Online payments settings. Only set `JAZZCASH_CHECKOUT_URL` and `JAZZCASH_INQUIRY_URL` if JazzCash
gives you different hosts.

**Test connection** sends a Status Inquiry for a reference that was never used (`TCHK...`). Success is a reply signed
with your integrity salt, usually "transaction not found". Common failures:

| Shows | Means |
| --- | --- |
| Code 101 or 115 | Merchant ID or password wrong (101), or the salt does not belong to this merchant (115) |
| "Reply signed with your integrity salt" failed | The salt has a typo or belongs to another merchant or environment |
| HTTP 401/403 | Credentials refused, or our server IP is not allow-listed |
| TIMEOUT / NETWORK | The server cannot reach JazzCash: check outbound internet and DNS |

**Sandbox test**: in the console start a small live test with JazzCash, Rs 10. You are sent to JazzCash's sandbox page;
pay with the sandbox test wallet or card JazzCash gave you. You come back to the console on the run.
Success: a "Browser return" call marked Verified, then usually an "IPN", the checkout is Paid with a receipt number,
and the gateway code is `000`. Then **Reverse test payment**: the run shows "Passed and reversed".
If you come back but no call is listed, press **Ask the gateway now** (Status Inquiry). If that pays the run, the
return URL is wrong at JazzCash's end.

**Live test**: switch to `PAYMENTS_MODE=live` with the live credentials, restart, run Test connection again, then a
small live test of Rs 10 with a real wallet. Tick the live-mode confirmation. Success looks the same as in sandbox,
with a real JazzCash transaction ID. Reverse it, and refund the Rs 10 from the JazzCash merchant portal if wanted
(reversing in SchoolSyncer does not send money back).

**Rollback**: clear the `JAZZCASH_*` variables (or switch JazzCash off in the school's settings) and restart. Parents
no longer see JazzCash. Open checkouts are still confirmed by the nightly reconciliation while credentials remain,
so remove credentials only after checking **Fees > Online payments** for waiting JazzCash checkouts.

## Easypaisa

**Ask Easypaisa for** (sandbox, then live):

- Store ID and the 16-character hash key for the **Easypay hosted checkout** (`Index.jsf` / `Confirm.jsf`).
- API username and password for **Inquire Transaction** (these are not the merchant portal login).
- The merchant account number, if they want it sent (optional).
- Their response code list, to compare with `apps/api/src/fees/gateways/samples/easypaisa.json`.
- Whether the API needs our server IP allow-listed.

**Register with Easypaisa**:

| What | Address |
| --- | --- |
| Post-back URL | `https://<API_PUBLIC_URL>/api/payments/return/easypaisa` |
| IPN URL | `https://<API_PUBLIC_URL>/api/payments/ipn/easypaisa` |

**Fill in**: `EASYPAISA_STORE_ID`, `EASYPAISA_HASH_KEY`, `EASYPAISA_USERNAME`, `EASYPAISA_PASSWORD`,
`EASYPAISA_ACCOUNT_NUM` (optional), or the Easypaisa card in the school's settings. `EASYPAISA_BASE_URL` only if they
give you another host.

**Test connection** sends Inquire Transaction for a made-up order. Success is code `0000` or `0003` (order not
found), which proves the store ID, API username and password. The hash key is only used when a checkout starts, so
the check only confirms it is 16 characters; the sandbox payment proves it. Failures show Easypaisa's code (for
example `0006` unknown store, `0005`/`0007` not active yet) with a hint, or HTTP 401/403 for refused credentials.

**Sandbox test**: small live test with Easypaisa, Rs 10, paid with the sandbox mobile account. Success: a "Browser
return" (and often an "IPN") marked Verified, checkout Paid with a receipt. If Easypaisa refuses to open the checkout
page, the hash key is wrong. Reverse the test.

**Live test**: as for JazzCash: live credentials, Test connection, Rs 10 with a real Easypaisa account, reverse,
refund from the merchant portal if wanted.

**Rollback**: clear the `EASYPAISA_*` variables or switch Easypaisa off for the school, after checking for waiting
Easypaisa checkouts.

## 1Bill (1LINK)

1Bill works the other way round: 1LINK calls us when a parent asks a banking app about a 1Bill number and when they
pay it. There is nothing for us to call.

**Ask 1LINK for**: a biller prefix (one per school that has its own account; one for the server account), and agree
the username and password 1LINK will send in the `username` and `password` headers. Ask which IP addresses 1LINK
calls from if you want to allow-list them at the firewall.

**Give 1LINK**:

| What | Address or value |
| --- | --- |
| Bill inquiry URL | `https://<API_PUBLIC_URL>/api/payments/1bill/bill-inquiry` |
| Bill payment URL | `https://<API_PUBLIC_URL>/api/payments/1bill/bill-payment` |
| Biller prefix, username | as shown by Test connection |
| Password | the one you saved (Test connection never shows it) |

**Fill in**: `ONEBILL_BILLER_PREFIX`, `ONEBILL_USERNAME`, `ONEBILL_PASSWORD`, or the 1Bill card in the school's
settings (switched on and saved). `ONEBILL_VALID_DAYS` sets how long a number stays payable (default 3).

**Test connection** is a local self-test: it calls our own bill inquiry and bill payment handlers the way 1LINK
would, with the saved credentials, for a consumer number that cannot exist. Success: the credentials are accepted, a
wrong password is refused, both handlers answer "not found" (`01`), and `API_PUBLIC_URL` is public. It also lists
what to give 1LINK.

**Sandbox test**: 1LINK's UAT calls our server, so the API must be public. Start a small live test with 1Bill; the
run shows a 1Bill number. Ask 1LINK (or use their UAT banking app) to inquire and pay it. Success: a "1LINK bill
inquiry" then a "1LINK bill payment" call, both Verified, payment code `00`, the checkout Paid with a receipt. A call
marked "Not verified" means 1LINK sent other credentials. Reverse the test.

**Live test**: pay a real Rs 10 1Bill number from your own banking app, watch both calls arrive, then reverse. 1Bill
payments cannot be refunded through us; the Rs 10 settles to the biller's account.

**Rollback**: ask 1LINK to stop routing the prefix, or clear `ONEBILL_*` / switch 1Bill off for the school. With no
matching account 1LINK's calls are refused, so banking apps show the bill as unavailable.

## After going live

- Watch **Fees > Reconciliation** for the first few days, and upload each gateway's daily statement.
- Keep the test history: it is the record that each gateway was proven end to end, by whom and when.
- If a gateway changes its API, update the sample payloads and run the contract tests before deploying.
