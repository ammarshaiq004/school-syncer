# SchoolSyncer

A modern school management portal: admissions, attendance, fees, exams, staff and
parent communication for every campus, in one place. See the
[implementation plan](https://claude.ai/code/artifact/2d21f836-f248-4e3f-a2a9-7803a060159d)
for the full module list and roadmap.

**Built so far: Phase 0 (Foundation), Phase 1 (Core operations) and, from Phase 2, exams, report cards, timetables, homework, HR, payroll, accounts, reports and the parent and teacher mobile app.**

Phase 3, extensions (in progress):

- Transport: vans and buses with their drivers and seats, routes with ordered stops and pick-up and drop times, and riders by stop. A full van refuses new riders, a printable driver's list has every parent's number, the monthly fee (a stop can charge more) goes on the fee voucher, moves and stops keep a history, and parents see the route, stop, times and driver's number on the web and in the app.
- Library: a catalogue of books with numbered copies, an issue desk that finds a copy by its number and a student or teacher by name, due dates from the school's loan period, a limit on books per student, and no new books for a student with one overdue. Late returns are fined per day, lost books can be charged, and unpaid fines go on the next fee voucher. Parents see the books their child has out on the web and in the app.

Phase 2, academics:

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
pnpm db:seed           # optional demo schools (see Demo data)
pnpm dev               # API on :4000, web on :3000
```

## Demo data

`pnpm db:seed` builds two schools with a realistic term of activity, dated relative to today so it always looks current. `pnpm db:seed --reset` deletes and rebuilds them; other schools are left alone. Every login's password is `password123`.

**City Grammar School** (school code `demo-school`, Lahore): two campuses (Model Town, with Playgroup to Grade 8, and Johar Town, with Playgroup to Grade 5), about 490 students in 300 families with siblings, 47 staff, and from the start of the academic year:

- daily attendance with a few chronic absentees, and today's registers partly taken;
- monthly fee vouchers with sibling, staff-child and merit concessions, payments by cash, bank, JazzCash, Easypaisa and 1Bill, some late or part payments, and a few defaulting families;
- a published first-term exam with positions and remarks, and a monthly test still being marked;
- timetables for every section with no teacher clashes, two weeks of homework, finalised and paid payroll for past months, staff attendance and leave, running costs and other income, four van routes with about 55 riders, a library of about 70 titles with books out, a few overdue and some small fines owed, an admissions pipeline, announcements and a message log.

| Login | Role |
| --- | --- |
| `owner@demo.pk` | Owner (whole school) |
| `principal@demo.pk` | Principal (whole school) |
| `johar.head@demo.pk` | Campus head, Johar Town only |
| `admin@demo.pk` | Admin officer, Model Town only |
| `accountant@demo.pk` | Accountant |
| `teacher@demo.pk` | Mathematics teacher and a class teacher |
| `03001234567` | Parent (Imran Khan) with three children |

**Bright Future School** (school code `bright-future`, Faisalabad): a smaller single-campus school, to check that schools never see each other's data. Owner login `owner@brightfuture.pk`.

**SchoolSyncer console** at `/platform/login`: sign in as `admin@schoolsyncer.pk`. City Grammar is a paying Growth customer with six months of bills, Bright Future is nine days from the end of its free trial, and five small customer schools (owner login `owner@<school code>.pk`) cover the other states: Al-Huda Academy (active, Starter), Beaconlight School (two bills overdue, so read-only), Green Valley School (suspended, can't sign in), Sunrise Montessori (trial ended, read-only) and Iqra Public School (trial just started).

`docs/sample-data/` has spreadsheets for trying the student import against the demo school: `new-admissions.xlsx` (40 clean rows) and `new-admissions-with-mistakes.xlsx` (rows with the usual problems).

## Running it as a service

SchoolSyncer is sold to schools as a monthly subscription. SchoolSyncer staff run it from the console at `/platform`; each school sees its own plan under **Plan and billing**.

- **Plans.** Starter, Growth and Enterprise, each priced per active student per month with a minimum, a student and campus limit, and a set of modules (admissions, fees, exams, homework, timetable, HR and payroll, accounts, reports). Student records, attendance, announcements, users and the parent portal come with every plan. Staff can change prices, limits and modules in the console.
- **Trial.** A school that registers gets 30 days of Growth free. When it ends, the school can still look everything up but can't change anything until the owner picks a plan.
- **Bills.** Staff create each month's bills from the console; every active or past-due school is billed for its active students that day. A bill unpaid 15 days after its due date makes the school read-only until it is paid. Suspended and cancelled schools can't sign in.
- **Limits and modules** are enforced by the API: a module outside the plan returns 403 and its menu item is hidden, and adding students or campuses past the limit is refused with a message to upgrade.
- **Support.** Staff can sign in to a school as its owner for an hour to help; it's recorded in the school's audit log and the console's history.

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
| GET, POST, PATCH | `/transport/vehicles`, `/transport/routes`, PUT `/transport/routes/:id/stops`, GET `/transport/routes/:id` | staff can read; changes need owner, principal or admin |
| GET, POST | `/transport/students/:id`, `/transport/assignments`, `/transport/assignments/:id/end` | staff can read; changes need owner, principal or admin |
| GET, POST, PATCH | `/library/books`, `/library/books/:id`, `/library/books/:id/copies`, `/library/copies/:id`, `/library/settings` | staff can read and lend; rules need owner, principal or admin |
| GET, POST | `/library/copies/:accessionNo`, `/library/borrowers`, `/library/loans`, `/library/loans/:id/return`, `/library/loans/:id/lost`, `/library/loans/:id/fine` | staff; letting a fine off needs owner, principal, admin or accountant |
| GET, POST | `/subscription`, POST `/subscription/plan` | owner, principal, admin or accountant; choosing a plan needs the owner |
| POST, GET | `/platform/auth/login`, `/platform/auth/me` | SchoolSyncer staff (separate login) |
| GET | `/platform/overview`, `/platform/schools`, `/platform/schools/:id` | SchoolSyncer staff |
| PATCH, POST | `/platform/schools/:id/subscription`, `/platform/schools/:id/support-login` | SchoolSyncer staff |
| GET, PATCH | `/platform/plans`, `/platform/plans/:id` | SchoolSyncer staff |
| GET, POST | `/platform/invoices`, `/platform/invoices/generate`, `/platform/invoices/:id/pay`, `/platform/invoices/:id/void` | SchoolSyncer staff |

## WhatsApp and payments setup

By default messages are only written to the API log and the in-app message log (`NOTIFY_DRIVER=log`), so nothing is sent while developing. To send real WhatsApp messages:

1. Create a WhatsApp Business account in Meta Business Manager and get a permanent token and phone number id.
2. Create and get approval for these message templates (names and parameter order must match `apps/api/src/notifications/templates.ts`): `attendance_absent`, `fee_voucher`, `fee_reminder`, `fee_paid`, `parent_invite`, `exam_result`, `homework_assigned`, `school_announcement`.
3. Set `NOTIFY_DRIVER=whatsapp`, `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID`.

Payment gateways post to `/api/payments/webhook/<jazzcash|easypaisa|onebill|card>` with `{ voucherNo, amount, reference }` and an `X-Signature` header holding the HMAC-SHA256 of the raw body, using `PAYMENT_WEBHOOK_SECRET_<PROVIDER>`. Each gateway's own callback format still needs a small adapter once its merchant account is approved.
