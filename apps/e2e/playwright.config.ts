import { defineConfig, devices } from '@playwright/test';
import { API_PORT, API_URL, WEB_PORT, WEB_URL } from './support/env';

if (!process.env.DATABASE_URL) {
  throw new Error('Set DATABASE_URL to the database the e2e API should use (it seeds and deletes its own schools).');
}

/**
 * Browser tests for the web portal. Playwright starts the built API and web
 * app on their own ports (never 3000/4000, so a dev server can keep running),
 * a setup project seeds a school through the API, and a teardown project
 * deletes it again. Build first with `pnpm --filter e2e e2e:build`: the web
 * bundle has the API address baked in.
 */
export default defineConfig({
  testDir: './tests',
  // The tests share one seeded school and some change it, so run them in order.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: WEB_URL,
    // The school's day: the web app dates registers and vouchers by the browser's clock.
    timezoneId: 'Asia/Karachi',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'seed', testMatch: /seed\.setup\.ts/, teardown: 'cleanup' },
    { name: 'cleanup', testMatch: /cleanup\.teardown\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['seed'],
    },
  ],
  webServer: [
    {
      command: 'node dist/main',
      cwd: '../api',
      url: `${API_URL}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        PORT: String(API_PORT),
        DATABASE_URL: process.env.DATABASE_URL,
        JWT_SECRET: process.env.JWT_SECRET ?? 'e2e-only-secret',
        WEB_ORIGIN: WEB_URL,
        NODE_ENV: 'test',
      },
    },
    {
      command: `pnpm exec next start -p ${WEB_PORT}`,
      cwd: '../web',
      url: `${WEB_URL}/login`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
