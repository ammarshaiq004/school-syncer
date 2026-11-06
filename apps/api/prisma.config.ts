// Prisma CLI settings (migrate, generate, seed). Prisma 7 no longer reads
// .env itself, so load apps/api/.env here; variables already set win.
import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  // Empty is fine for `prisma generate` (postinstall); migrate needs it set.
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
