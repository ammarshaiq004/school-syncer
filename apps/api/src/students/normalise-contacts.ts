// One-off data migration for SCHOOL-123: puts phone numbers, CNICs and
// B-Forms saved before the canonical-form rule into that form.
//
//   pnpm --filter api data:normalise-contacts            (dry run: reports only)
//   pnpm --filter api data:normalise-contacts --apply    (makes the changes)
//   ... --school <schoolId>                              (one school only)
//   node dist/students/normalise-contacts.js --apply     (built image, no dev tools)
//
// Rows it cannot normalise are listed (table, id, value, reason) and left
// alone; the run never stops on them. Safe to run again.
import { PrismaClient } from '@prisma/client';
import { parseArgs } from 'node:util';
import { normaliseContacts } from './contact-cleanup.js';

async function main() {
  const { values } = parseArgs({
    options: { apply: { type: 'boolean', default: false }, school: { type: 'string' } },
  });
  const prisma = new PrismaClient();
  try {
    const report = await normaliseContacts(prisma, { apply: values.apply, schoolId: values.school });
    const verb = values.apply ? 'Normalised' : 'Would normalise';
    for (const [field, n] of Object.entries(report.fixed)) console.log(`${verb} ${n} × ${field}`);
    if (report.mergedGuardians) {
      console.log(`${values.apply ? 'Merged' : 'Would merge'} ${report.mergedGuardians} duplicate guardian(s) into the matching record`);
    }
    if (!Object.keys(report.fixed).length) console.log('Nothing to normalise.');
    if (report.problems.length) {
      console.log(`\n${report.problems.length} row(s) could not be normalised and were left as they are:`);
      for (const p of report.problems) {
        console.log(`  ${p.table} ${p.id} (school ${p.schoolId}) ${p.field} "${p.value}": ${p.reason}`);
      }
    }
    if (!values.apply) console.log('\nDry run: nothing was changed. Run again with --apply to save.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
