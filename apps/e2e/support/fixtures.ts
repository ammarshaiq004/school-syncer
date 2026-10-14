import { test as base } from '@playwright/test';
import { readSeed, type Seed } from './seed';

/** `seed` is what the setup project created (read when a test runs, after setup). */
export const test = base.extend<{ seed: Seed }>({
  seed: async ({}, use) => use(readSeed()),
});
export { expect } from '@playwright/test';
