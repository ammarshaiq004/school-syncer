// Creates the first SchoolSyncer owner for the platform console.
//
//   pnpm --filter api platform:create-admin --email you@example.com --name "Your Name"
//   node dist/platform/create-admin.js --email ... --name ...   (built image, no dev tools)
//
// A strong password is generated and printed once, unless one is given in
// PLATFORM_ADMIN_PASSWORD or on stdin with --password-stdin. Either way it
// must be changed at first sign-in. Refuses when an active owner already
// exists; --force allows another owner or recovers an existing account.
import { PrismaClient } from '@prisma/client';
import { parseArgs } from 'node:util';
import { BootstrapError, createPlatformOwner } from './bootstrap-owner.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      force: { type: 'boolean', default: false },
      'password-stdin': { type: 'boolean', default: false },
    },
  });
  if (!values.email || !values.name) {
    console.error('Usage: platform:create-admin --email <email> --name <name> [--password-stdin] [--force]');
    process.exitCode = 1;
    return;
  }
  const password = values['password-stdin'] ? await readStdin() : process.env.PLATFORM_ADMIN_PASSWORD || undefined;

  const prisma = new PrismaClient();
  try {
    const result = await createPlatformOwner(prisma, {
      email: values.email,
      name: values.name,
      password,
      force: values.force,
    });
    console.log(
      `${result.recovered ? 'Recovered' : 'Created'} console owner ${result.admin.email}. ` +
        'Sign in at /platform/login; a new password is asked for at first sign-in.',
    );
    // Only a generated password is printed, and only this once.
    if (!password) console.log(`Temporary password: ${result.password}`);
  } catch (e) {
    if (!(e instanceof BootstrapError)) throw e;
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

await main();
