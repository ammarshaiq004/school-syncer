# Secrets, settings and key rotation

Every secret and environment variable SchoolSyncer reads: what uses it, how to generate it, how to rotate it, and what
happens if it leaks or is lost. Settings live in `apps/api/.env`, `apps/web/.env.local` and `apps/mobile/.env.local`
in development (copy the `.env.example` next to each), and in the host's secret store in production. Nothing here
depends on a particular host.

Generate every random secret the same way:

```bash
openssl rand -hex 32        # 64 hex characters
```

With `NODE_ENV=production` the API refuses to start when a secret is missing, still the example placeholder, shorter
than 32 characters, a pattern rather than random (fewer than 8 different characters, like `aaaa...` or `abab...`), or
the same value as another secret (including its own `_PREVIOUS`). All problems are listed at once.

## Secrets

| Secret | Used for | If it leaks | If it is lost |
| --- | --- | --- | --- |
| `JWT_SECRET` | Signs every session token (school users, parents, students, console staff, support sessions). Also keys the hashes of forgot-password codes, and signs file and photo links when `FILE_SIGNING_SECRET` is empty. | Anyone can mint a token for any user of any school, console owners included. **Rotate at once.** | Everyone is signed out (they sign in again). Forgot-password codes in flight stop working. Nothing is lost. |
| `JWT_SECRET_PREVIOUS` | Rotation only: old values, verify-only. | As above, until it is removed. | Nothing. |
| `FILE_SIGNING_SECRET` | Signs download links for files stored on local disk (`STORAGE_DRIVER=local`) and student photo links. Not needed with S3, which signs its own links. | Anyone who knows a file id can build a working link to it. Rotate. | Links already handed out stop working; saved student photo links break until re-signed (`secrets:reencrypt --apply`). Files are not lost. |
| `FILE_SIGNING_SECRET_PREVIOUS` | Rotation only: old values, verify-only. | As above, until removed. | Nothing. |
| `PAYMENTS_SECRET_KEY` | Encrypts (AES-256-GCM) what schools save in the portal: their own JazzCash / Easypaisa / 1Bill merchant secrets and their WhatsApp access tokens, and the sealed parameters (temporary passwords, reset codes) of messages waiting to be sent. 64 hex characters or a 32+ character passphrase. | Someone who also has a database copy can read every school's merchant credentials and WhatsApp tokens. Rotate the key, and ask schools to change those credentials with their providers. | **Every saved school secret is unreadable.** Their accounts count as switched off (payments fall back to the server's own account, or stop) until each school enters them again. Back this key up separately from the database. |
| `PAYMENTS_SECRET_KEY_PREVIOUS` | Rotation only: old keys, decrypt-only. | As above. | Values still sealed with it cannot be read: keep it until the re-encryption script reports nothing left. |
| `DATABASE_URL` | Postgres connection, with its password. | Full access to every school's data. Change the database password, then this. | The API cannot start. Recover from the database host. |
| `PAYMENT_WEBHOOK_SECRET_JAZZCASH` / `_EASYPAISA` / `_ONEBILL` | HMAC-SHA256 of signed payment callbacks (`X-Signature`). | Someone could forge "paid" callbacks. Rotate with the provider. | Signed callbacks are refused until it is set again. |
| `JAZZCASH_*`, `EASYPAISA_*`, `ONEBILL_*` (passwords, salts, hash keys) | The server's own merchant accounts, for schools without one. | Payments could be forged or inquired in our name. Rotate in the provider's portal. | Gateways that depend on them disappear from the parent's options. |
| `WHATSAPP_TOKEN` | Platform WhatsApp Cloud API sender. | Messages can be sent from our number. Revoke in Meta Business settings. | Platform messages are marked "Not delivered". |
| `SMS_GATEWAY_API_KEY` | Platform SMS gateway. | SMS sent (and billed) in our name. Rotate with the aggregator. | SMS fail. |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Uploaded files in S3-compatible storage. | Read and delete access to every uploaded file. Rotate in the provider's console. | Uploads and downloads fail. |
| `ANTHROPIC_API_KEY` | The AI assistant. | Usage billed to us. Rotate in the Anthropic console. | Assistant questions are off; templates still work. |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | Error tracking (Sentry or GlitchTip). Not very secret: the web one is in the browser bundle, and a DSN only allows sending events. | Junk events can be sent to the project. Rotate the project key. | Errors go to the log only. |
| `ALERT_WEBHOOK_URL` | Where alerts are posted (Slack-compatible). The URL is the credential. | Anyone can post to that channel. Regenerate the webhook. | Alerts go to staff phones and the log only. |
| `PLATFORM_ADMIN_PASSWORD` | One-off: the first console owner's password for `platform:create-admin`. Must be changed at first sign-in. | Unset it after use. | Nothing. |

Schools' own credentials are never in the environment: they are entered in the portal and stored encrypted with
`PAYMENTS_SECRET_KEY`. Error reports and alerts are scrubbed of passwords, tokens, CNICs, phone numbers, emails and
card-like numbers before they leave the server or the browser.

## Rotating secrets

Each `_PREVIOUS` variable takes one value or a comma-separated list. Previous values are only ever used to **verify or
decrypt**; everything new is signed or encrypted with the current value. Roll the change out to every API instance
before starting the next step.

### JWT_SECRET

1. Set `JWT_SECRET_PREVIOUS` to the current value and `JWT_SECRET` to a new one; restart the API instances.
   Existing sessions keep working; new sign-ins get tokens signed with the new secret.
2. After `JWT_EXPIRES_IN` (12 hours by default) every old token has expired: remove `JWT_SECRET_PREVIOUS` and restart.

After a leak, skip the window: change `JWT_SECRET` without setting a previous value, so every session ends at once.
If `FILE_SIGNING_SECRET` is empty, file and photo links are signed with `JWT_SECRET` too: run step 3 of the next
section before removing the previous value.

### FILE_SIGNING_SECRET

1. Set `FILE_SIGNING_SECRET_PREVIOUS` to the current value and `FILE_SIGNING_SECRET` to a new one; restart.
2. Re-sign saved student photo links: `pnpm --filter api secrets:reencrypt --apply` (it also handles payment secrets,
   below, and needs `PAYMENTS_SECRET_KEY` to be set).
3. Download links live for three hours; once the script has run and three hours have passed, remove the previous
   value and restart.

### PAYMENTS_SECRET_KEY

1. Set `PAYMENTS_SECRET_KEY_PREVIOUS` to the current key and `PAYMENTS_SECRET_KEY` to a new one; restart every API
   instance. Saved secrets still open (each stored value records which key sealed it), and anything a school saves
   now is sealed with the new key.
2. Re-encrypt everything saved, from a machine or container with the same environment and database:

   ```bash
   pnpm --filter api secrets:reencrypt            # dry run: what would change
   pnpm --filter api secrets:reencrypt --apply    # reseal with the new key
   node dist/platform/reencrypt-secrets.js --apply   # in a built image
   ```

   It reseals schools' merchant accounts, WhatsApp tokens and the sealed parameters of queued messages, and re-signs
   student photo links. It reads `apps/api/.env` when present (variables already set win). A value no key opens is
   listed and left alone (exit code 2): keep the key that sealed it as a previous key, or ask that school to enter
   the credentials again. Running it twice is safe; a row a school saves meanwhile is never overwritten.
3. When a run reports nothing left to re-encrypt, remove `PAYMENTS_SECRET_KEY_PREVIOUS` and restart.

Values sealed before key rotation existed (`v1:`) open with any configured key and are resealed in the new format by
the script.

### Everything else

Provider credentials (gateways, WhatsApp, SMS, S3, Anthropic) have no overlap window in SchoolSyncer: create the new
credential with the provider, update the variable, restart, then revoke the old one. For `DATABASE_URL`, add a new
database user or password first, switch, then remove the old one.

## Other settings

| Variable | App | What it does |
| --- | --- | --- |
| `NODE_ENV` | API, web | `production` turns on the strict checks above, JSON logs, and safe defaults (`PAYMENTS_MODE=off`). |
| `PORT` | API | Listening port (4000). |
| `WEB_ORIGIN` | API | Comma-separated browser origins allowed by CORS. |
| `TRUST_PROXY` | API | Proxy hops or addresses, so rate limits and logs see the real client IP. |
| `API_PUBLIC_URL`, `WEB_PUBLIC_URL` | API | Public https addresses (signed links, payment returns). |
| `JWT_EXPIRES_IN` | API | Session length (12h). Also the length of a JWT rotation window. |
| `STORAGE_DRIVER`, `STORAGE_LOCAL_DIR`, `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE` | API | File storage. |
| `NOTIFY_DRIVER`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_LANGUAGE`, `SMS_GATEWAY_URL`, `SMS_SENDER_ID`, `SMS_GATEWAY_METHOD`, `SMS_GATEWAY_SUCCESS_MATCH` | API | Platform message sender (see the README's messaging section). Also used for alerts to console staff. |
| `JOBS_WORKER`, `JOBS_POLL_MS`, `JOBS_CONCURRENCY` | API | Background job workers. At least one instance must run them. |
| `PAYMENTS_MODE`, `PAYMENTS_CHECKOUT_MINUTES`, `ONEBILL_VALID_DAYS`, `EASYPAISA_BASE_URL`, `JAZZCASH_CHECKOUT_URL`, `JAZZCASH_INQUIRY_URL` | API | Online payments (see [online-payments.md](online-payments.md)). |
| `RECONCILE_AT` | API | Nightly reconciliation time, school-local (`02:00`), or `off`. |
| `SCHOOL_TIMEZONE` | API | Time zone for school dates (`Asia/Karachi`). |
| `ASSISTANT_MODEL`, `ASSISTANT_DAILY_LIMIT` | API | AI assistant model and per-user daily limit. |
| `NEXT_PUBLIC_API_URL` | web | The API's public address, baked in at build time; the build fails without it. |
| `EXPO_PUBLIC_API_URL` | mobile | The API's public address for the app. |
| `RATE_LIMIT_NAMESPACE` | API | Tests only: prefixes rate-limit counters. |

## Monitoring

All optional. With nothing set, errors are logged with their request id, `GET /api/health/ready` works, and alerts
are shown on the console's **System health** page and written to the log.

| Variable | App | What it does |
| --- | --- | --- |
| `SENTRY_DSN` | API | Sends server errors (5xx answers, failed background jobs, crashes) to Sentry or a self-hosted GlitchTip. |
| `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE` | API | Shown with each event (environment defaults to `NODE_ENV`). |
| `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_ENVIRONMENT`, `NEXT_PUBLIC_SENTRY_RELEASE` | web | The same for the portal (build time). Use a separate project. The page's CSP allows the DSN's host. |
| `LOG_FORMAT` | API | `json` or `pretty`; JSON lines by default in production, each with `requestId`. |
| `ALERT_WEBHOOK_URL` | API | Slack-compatible incoming webhook for alerts (`{"text": ...}`); https in production. |
| `ALERT_EVERY_MINUTES` | API | How often the alert check runs on the job queue (5), or `off`. |
| `ALERT_REPEAT_MINUTES` | API | The same open problem is repeated at most this often (360). A new or resolved problem is sent at once. |
| `ALERT_FAILED_JOBS` | API | Alert when this many background jobs failed for good in the last hour (5). |
| `ALERT_MESSAGE_FAILURE_PERCENT`, `ALERT_MESSAGE_MIN_COUNT` | API | Alert when this share of the last hour's messages failed (20%), out of at least this many (20). |
| `READY_MAX_JOB_LAG_SECONDS`, `READY_MAX_JOB_BACKLOG`, `READY_MAX_RECONCILE_AGE_HOURS` | API | Readiness fails when the oldest due job waited longer (900 s), more jobs are due (10000), or the last successful nightly reconciliation is older (36 h). |

Every API answer carries an `X-Request-Id` header (an incoming one that looks like an id is kept, so a proxy's id
lines up), error bodies include `requestId`, and the portal shows the start of it as a reference on server errors.

`GET /api/health` is liveness (database only), for load balancers. `GET /api/health/ready` is readiness for deploy
gates and uptime monitors: database, job queue backlog and lag, and the nightly reconciliation's age; it answers 503
with the failing check. Point an external uptime monitor at it: the alert check runs on the job queue, so when no
worker is running it cannot send the alert itself. Console staff get alerts on their phone once an owner adds a number under **Platform staff**,
provided the platform sender (`NOTIFY_DRIVER`) is WhatsApp or SMS. The mobile app has no error tracking yet: the
Sentry React Native SDK is a native dependency and would need a new store build.
