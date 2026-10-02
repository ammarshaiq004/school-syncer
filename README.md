# SchoolSyncer

A modern school management portal: admissions, attendance, fees, exams, staff and
parent communication for every campus, in one place. See the
[implementation plan](https://claude.ai/code/artifact/2d21f836-f248-4e3f-a2a9-7803a060159d)
for the full module list and roadmap.

**Built so far: Phase 0 (Foundation) and Phase 1 (Core operations).**

Phase 1, core operations:

- Admissions pipeline (enquiry, test, interview, offer, admit) with a public enquiry page at `/apply/<school-code>`.
- Student records with guardians (siblings share a guardian), class enrollments and roll numbers.
- Daily attendance from a phone: one tap per absent child, and a WhatsApp alert to the parent the first time a child is marked absent that day. Teachers can only mark their own sections.
- Fees: fee heads, class fee structures, concessions, monthly voucher runs, printable three-copy vouchers, counter payments, defaulters with late fines, and WhatsApp reminders.
- Online payments: signed webhook endpoint for JazzCash, Easypaisa and 1Bill confirmations, with replay protection.
- Announcements to the whole school, a campus, a class or a section, with optional WhatsApp delivery.
- Parent portal: attendance and unpaid fees for each child, with logins sent to parents on WhatsApp.
- Live dashboard: attendance today, fees billed and collected, admissions pipeline.
- Message log of everything sent to parents.

Phase 0, foundation:

- Multi-school tenancy: every record belongs to a school, and the API never lets one school read or link another school's data.
- Sign-up for a new school (creates the school, a main campus and the owner account) and sign-in by email or phone.
- Role-based access with per-campus roles (owner, principal, admin, accountant, teacher, class teacher, parent, student, staff).
- School setup: campuses, academic years, classes, sections and subjects.
- User management with roles, and an audit log of every setup change.
- Web app with dashboard, campuses, classes and sections, and users and roles screens.

## Structure

| Path | What it is |
| --- | --- |
| `apps/api` | NestJS API (TypeScript), Prisma ORM, PostgreSQL |
| `apps/web` | Next.js web app (React, Tailwind CSS) |
| `docker-compose.yml` | Local PostgreSQL and Redis |

## Run it locally

Needs Node 22+, pnpm 10 and Docker.

```bash
pnpm install
docker compose up -d
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
pnpm db:migrate        # create tables
pnpm db:seed           # optional demo school
pnpm dev               # API on :4000, web on :3000
```

Demo login after seeding: school code `demo-school`, email `owner@demo.pk`, password `password123`. The seed adds 24 students, fee structures and two admission enquiries.

## Tests

```bash
pnpm --filter api test       # unit tests
pnpm --filter api test:e2e   # API tests against the database in DATABASE_URL
pnpm lint
pnpm build
```

## API overview

All routes are under `/api` and need `Authorization: Bearer <token>` except health, register and login.

| Method | Path | Who |
| --- | --- | --- |
| GET | `/health` | anyone |
| POST | `/auth/register-school` | anyone |
| POST | `/auth/login` | anyone |
| GET | `/auth/me` | signed in |
| GET, PATCH | `/school` | signed in; PATCH needs owner, principal or admin |
| GET, POST, PATCH, DELETE | `/campuses` | signed in; changes need owner, principal or admin |
| GET, POST | `/academic-years` | same |
| GET, POST | `/classes`, POST `/classes/:id/sections` | same |
| GET, POST | `/subjects` | same |
| GET, POST | `/users` | owner, principal or admin |
| GET, POST, PATCH | `/students`, POST `/students/:id/guardians/:gid/invite` | staff; changes need owner, principal or admin |
| GET, POST, PATCH | `/applications`, POST `/applications/:id/admit`, GET `/applications/funnel` | owner, principal or admin |
| POST | `/public/:school/enquiries`, GET `/public/:school/admission-options` | anyone |
| GET, PUT | `/attendance/sheet`, GET `/attendance/summary`, GET `/attendance/students/:id` | admins, and teachers for their own sections |
| GET, POST, PUT | `/fees/heads`, `/fees/structures`, `/fees/students/:id/concessions` | owner, principal, admin or accountant |
| POST, GET | `/fees/invoices/generate`, `/fees/invoices`, `/fees/invoices/:id`, `/fees/invoices/:id/payments` | same |
| GET, POST | `/fees/defaulters`, `/fees/reminders` | same |
| POST | `/payments/webhook/:provider` | payment gateways (signed) |
| GET, POST | `/announcements` | staff; posting needs owner, principal or admin |
| GET | `/dashboard/summary` | staff |
| GET | `/parent/children` | parents |
| GET | `/notifications` | owner, principal or admin |

## WhatsApp and payments setup

By default messages are only written to the API log and the in-app message log (`NOTIFY_DRIVER=log`), so nothing is sent while developing. To send real WhatsApp messages:

1. Create a WhatsApp Business account in Meta Business Manager and get a permanent token and phone number id.
2. Create and get approval for these message templates (names and parameter order must match `apps/api/src/notifications/templates.ts`): `attendance_absent`, `fee_voucher`, `fee_reminder`, `fee_paid`, `parent_invite`, `school_announcement`.
3. Set `NOTIFY_DRIVER=whatsapp`, `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID`.

Payment gateways post to `/api/payments/webhook/<jazzcash|easypaisa|onebill|card>` with `{ voucherNo, amount, reference }` and an `X-Signature` header holding the HMAC-SHA256 of the raw body, using `PAYMENT_WEBHOOK_SECRET_<PROVIDER>`. Each gateway's own callback format still needs a small adapter once its merchant account is approved.
