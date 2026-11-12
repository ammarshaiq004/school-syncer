# Fixing dates on already-imported local data

Data imported before SchoolSyncer could record real dates has today's date everywhere: every student "joined today", every old
payment was "received today", staff have no designation. New imports can now carry the dates themselves (an **Admission Date**
column in the student sheet, a **Paid on** date when recording a payment, a **Designation** on the staff record). This script
repairs data that was already imported.

**It only works on a local database.** It refuses to run unless `DATABASE_URL` points at this computer (`localhost`, `127.0.0.1`,
`::1`, `host.docker.internal`, or the compose service `postgres`), and never when `NODE_ENV=production`.

## 1. Prepare CSV files (any of the three; see `docs/sample-data/redate-*.csv`)

| File | Columns | What it changes |
| --- | --- | --- |
| students.csv | `admissionNo,admissionDate,leftDate` | Admission date; leaving date (only for students already marked Left or Graduated). A blank date is left as it is. |
| payments.csv | `receiptNo,paidOn` | Moves the receipt to that day (noon, school time) so "Collected today" and the fee chart count it there. |
| staff.csv | `employeeNo,designation` | Sets the designation, so the dashboard can count teaching staff. |

Dates are `YYYY-MM-DD`. Export these from the old system (admission register, receipt book, staff list).

## 2. Dry run first

```
pnpm --filter api data:redate --school demo-school --students students.csv --payments payments.csv --staff staff.csv
```

It prints how many rows it would change and lists every row it would skip (unknown admission number, bad date, leaving date
before admission, ...). Nothing is saved.

## 3. Apply

Add `--apply`. Running it again is safe: it sets the same values.

## Running it with the all-in-Docker local setup

If Node is not installed on the PC, run it inside the local API container instead. The service name below (`api`) is a guess:
check yours with `docker compose -p schoolsyncer-local ps` and use that name. Copy the CSV files in first, then run the built script:

```
docker compose -p schoolsyncer-local cp students.csv api:/tmp/students.csv
docker compose -p schoolsyncer-local exec api node dist/students/redate-local.js --school demo-school --students /tmp/students.csv
```

Add `--apply` to the last command once the dry run looks right. Take a copy of the database first if the data matters
(`pg_dump` on the Postgres container).
