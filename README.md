# SchoolSyncer

A modern school management portal: admissions, attendance, fees, exams, staff and
parent communication for every campus, in one place. See the
[implementation plan](https://claude.ai/code/artifact/2d21f836-f248-4e3f-a2a9-7803a060159d)
for the full module list and roadmap.

**Built so far: Phase 0 (Foundation), Phase 1 (Core operations) and, from Phase 2, exams, report cards, timetables, homework, HR, payroll, accounts, reports and the parent and teacher mobile app.**

Phase 2, academics (in progress):

- Exams with per-class papers (total and pass marks), and a school grading scale.
- Marks entry by subject teachers, only for the subjects they teach; administrators can fill any sheet and see what is still missing.
- Publishing freezes totals, grades, pass/fail and class positions, and can tell parents on WhatsApp. Unpublishing reopens marks for corrections and keeps remarks.
- Printable report cards with teacher and principal remarks and attendance, visible to parents in their portal.
- Subjects and subject teachers per section, set from the Classes screen.
- Bell schedule per campus, and a weekly timetable per section that fills in the subject teacher and refuses to put a teacher in two classes at once. Teachers get a "my week" view; parents see their child's timetable.
- Homework set by subject teachers, with an optional WhatsApp note to parents, and shown to parents in their portal.
- Staff records (designation, CNIC, bank, basic salary, fixed allowances and deductions), a daily staff register, and leave requests that staff send and admins approve.
- Accounts: other income and expenses by category, and a cash book that pulls in fee receipts and paid salaries with opening and closing balances.
- Reports: income and expenditure, fee collection by day, method and class, outstanding fees by class and student, and monthly attendance with students below a threshold. Every list downloads as a CSV for Excel.
- Mobile app for Android and iOS (Expo). Parents see attendance, homework, results with report cards, the timetable and fees due for each child. Teachers see today's classes, take attendance with one tap per absent child, and set homework.
- Monthly payroll: absent days and unpaid leave are deducted at a day's basic, drafts can be recalculated, finalised months are locked, salaries are marked paid, and staff see printable payslips.

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
| `apps/mobile` | Expo (React Native) app for parents and teachers |
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

Demo login after seeding: school code `demo-school`, email `owner@demo.pk` (or `teacher@demo.pk` and `accountant@demo.pk`), password `password123`. The seed adds 24 students, subject teachers, fee structures, two admission enquiries and a mid-term exam with all marks entered (ready to publish), a bell schedule, timetables, a homework item, staff salary details ready for a payroll run, and a few months of other income and expenses.

## Mobile app

```bash
cp apps/mobile/.env.example apps/mobile/.env.local   # point EXPO_PUBLIC_API_URL at the API
pnpm --filter mobile start                           # scan the QR code with Expo Go
```

On a phone, the API URL must be your computer's network address (for example `http://192.168.1.20:4000/api`), not `localhost`. To preview the app in a browser, run `pnpm --filter mobile web` and add `http://localhost:8081` to `WEB_ORIGIN` in `apps/api/.env` (it takes a comma-separated list). Store builds are made with EAS (`npx eas-cli build`), which needs an Expo account.

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
| GET, PUT | `/classes/sections/:id/subjects` | staff; PUT needs owner, principal or admin |
| GET, PUT | `/exams/grade-bands` | staff; PUT needs owner, principal or admin |
| GET, POST | `/exams`, GET `/exams/:id`, PUT `/exams/:id/papers`, DELETE `/exams/:id/papers/:pid` | staff; changes need owner, principal or admin |
| GET, PUT | `/exams/:id/marks`, GET `/exams/:id/progress` | admins, and teachers for subjects they teach |
| POST | `/exams/:id/publish`, `/exams/:id/unpublish` | school-wide owner, principal or admin |
| GET, PUT | `/exams/:id/results`, `/exams/:id/results/:sid/remarks` | staff; remarks by the class teacher or admins |
| GET | `/exams/:id/report-cards/:sid` | staff, and parents for their own children once published |
| GET, PUT | `/timetable/periods`, `/timetable/sections/:id` | staff; PUT needs owner, principal or admin |
| GET | `/timetable/me`, `/timetable/teachers/:id`, `/timetable/students/:id` | the teacher; admins; staff and the child's parents |
| GET, POST, DELETE | `/homework` | staff can read; teachers set homework for subjects they teach |
| GET, PUT | `/hr/staff`, `/hr/staff/:userId` | owner, principal, admin or accountant; PUT needs owner, principal or admin |
| GET, PUT | `/hr/attendance` | owner, principal or admin |
| GET, POST | `/hr/leave`, POST `/hr/leave/:id/decide` | staff apply and see their own; owner, principal or admin decide |
| GET, POST | `/hr/payroll`, `/hr/payroll/:id`, `/hr/payroll/:id/finalize`, `/hr/payroll/:id/payslips/:pid/pay` | owner, principal, admin or accountant |
| GET | `/hr/payslips/mine`, `/hr/payslips/:id` | staff, for their own finalised payslips |
| GET, POST, DELETE | `/accounts/categories`, `/accounts/entries`, GET `/accounts/cashbook` | owner, principal, admin or accountant; DELETE needs owner, principal or admin |
| GET | `/reports/income-expense`, `/reports/fee-collection`, `/reports/outstanding` | owner, principal, admin or accountant |
| GET | `/reports/attendance` | owner, principal or admin |
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
2. Create and get approval for these message templates (names and parameter order must match `apps/api/src/notifications/templates.ts`): `attendance_absent`, `fee_voucher`, `fee_reminder`, `fee_paid`, `parent_invite`, `exam_result`, `homework_assigned`, `school_announcement`.
3. Set `NOTIFY_DRIVER=whatsapp`, `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID`.

Payment gateways post to `/api/payments/webhook/<jazzcash|easypaisa|onebill|card>` with `{ voucherNo, amount, reference }` and an `X-Signature` header holding the HMAC-SHA256 of the raw body, using `PAYMENT_WEBHOOK_SECRET_<PROVIDER>`. Each gateway's own callback format still needs a small adapter once its merchant account is approved.
