import { test as teardown } from '@playwright/test';
import { cleanupSeed } from '../support/db';

teardown('delete the seeded schools and console login', async () => {
  await cleanupSeed();
});
