// Re-encrypts saved school secrets after a PAYMENTS_SECRET_KEY rotation and
// re-signs saved photo links after a FILE_SIGNING_SECRET (or JWT_SECRET)
// rotation. See docs/secrets.md for the whole procedure.
//
//   pnpm --filter api secrets:reencrypt            (dry run: reports only)
//   pnpm --filter api secrets:reencrypt --apply    (makes the changes)
//   node dist/platform/reencrypt-secrets.js --apply     (built image, no dev tools)
//
// Needs the new key in PAYMENTS_SECRET_KEY and the old one in
// PAYMENTS_SECRET_KEY_PREVIOUS. Values no key opens are listed and left
// alone. Safe to run again: already current values are skipped.
import { parseArgs } from 'node:util';
import { createScriptPrismaClient } from '../prisma/client.js';
import { rotateSecrets, type TableReport } from './secret-rotation.js';

async function main() {
  // Also loads apps/api/.env, where the keys usually live.
  const prisma = createScriptPrismaClient();
  const { values } = parseArgs({ options: { apply: { type: 'boolean', default: false } } });
  try {
    const report = await rotateSecrets(prisma, { apply: values.apply });
    const verb = values.apply ? 'Re-encrypted' : 'Would re-encrypt';
    const line = (label: string, t: TableReport) => {
      console.log(`${label}: ${t.checked} checked, ${verb.toLowerCase()} ${t.resealed}${t.failed.length ? `, ${t.failed.length} unreadable` : ''}`);
      for (const f of t.failed) console.log(`  ${f.id}: ${f.error}`);
    };
    line('School merchant accounts', report.paymentAccounts);
    line('School WhatsApp senders', report.messagingSenders);
    line('Messages waiting to be sent', report.queuedMessages);
    console.log(`Student photo links: ${report.studentPhotos.checked} checked, ${values.apply ? 're-signed' : 'would re-sign'} ${report.studentPhotos.resigned}`);
    const failed = report.paymentAccounts.failed.length + report.messagingSenders.failed.length + report.queuedMessages.failed.length;
    if (failed) {
      console.log('\nSome values open with none of the keys: keep the key that sealed them in PAYMENTS_SECRET_KEY_PREVIOUS, or have the school enter them again.');
      process.exitCode = 2;
    }
    if (!values.apply) console.log('\nDry run: nothing was changed. Run again with --apply to save.');
    else if (!failed) console.log('\nDone. Once every API server runs with the new key, PAYMENTS_SECRET_KEY_PREVIOUS can be removed.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
