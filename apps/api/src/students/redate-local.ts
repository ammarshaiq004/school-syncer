// Fixes the dates and designations of data already imported into a LOCAL database:
// admission/leaving dates, payment dates and staff designations, from CSV files.
//
//   pnpm --filter api data:redate --school demo-school --students students.csv --payments payments.csv --staff staff.csv
//   ... add --apply to save (without it: a dry run that only reports)
//
// Files (header row required, dates YYYY-MM-DD, any of the three may be left out):
//   students.csv  admissionNo,admissionDate,leftDate      (blank date = leave as it is)
//   payments.csv  receiptNo,paidOn
//   staff.csv     employeeNo,designation
//
// It refuses to run unless DATABASE_URL points at this computer (localhost, 127.0.0.1, ::1,
// host.docker.internal or the compose service "postgres") and never in production. Safe to run again.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createScriptPrismaClient } from '../prisma/client.js';
import { assertLocalDatabase, parseCsv, redatePayments, redateStaff, redateStudents, type RedateReport } from './redate.js';

async function main() {
  const { values } = parseArgs({
    options: {
      apply: { type: 'boolean', default: false },
      school: { type: 'string' },
      students: { type: 'string' },
      payments: { type: 'string' },
      staff: { type: 'string' },
    },
  });
  const prisma = createScriptPrismaClient(); // loads apps/api/.env before the check below
  try {
    assertLocalDatabase(process.env.DATABASE_URL);
    if (!values.school) throw new Error('Pass --school <school code>, e.g. --school demo-school');
    if (!values.students && !values.payments && !values.staff) throw new Error('Pass at least one of --students, --payments, --staff');
    const school = await prisma.school.findUnique({ where: { slug: values.school } });
    if (!school) throw new Error(`No school with code "${values.school}"`);
    const read = (path: string) => parseCsv(readFileSync(path, 'utf8'));
    const jobs: [string, string | undefined, (rows: Record<string, string>[]) => Promise<RedateReport>][] = [
      ['students', values.students, (rows) => redateStudents(prisma, school.id, rows, values.apply)],
      ['payments', values.payments, (rows) => redatePayments(prisma, school.id, rows, values.apply)],
      ['staff', values.staff, (rows) => redateStaff(prisma, school.id, rows, values.apply)],
    ];
    for (const [name, file, run] of jobs) {
      if (!file) continue;
      const report = await run(read(file));
      console.log(`${values.apply ? 'Updated' : 'Would update'} ${report.changed} ${name}`);
      for (const p of report.problems) console.log(`  skipped: ${p}`);
    }
    if (!values.apply) console.log('\nDry run: nothing was changed. Run again with --apply to save.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exitCode = 1;
});
