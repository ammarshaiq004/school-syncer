# SchoolSyncer

A modern school management portal: admissions, attendance, fees, exams, staff and
parent communication for every campus, in one place. See the
[implementation plan](https://claude.ai/code/artifact/2d21f836-f248-4e3f-a2a9-7803a060159d)
for the full module list and roadmap.

This repository currently holds **Phase 0 (Foundation)**:

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

Demo login after seeding: school code `demo-school`, email `owner@demo.pk`, password `password123`.

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
