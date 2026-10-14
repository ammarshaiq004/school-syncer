import type { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { signIn } from '../support/session';

/** A host the policy blocks, loaded once to prove the watcher works. */
const PROBE = 'csp-probe.example';
const SCHOOL_PAGES = ['/dashboard', '/students', '/attendance', '/fees', '/exams', '/classes', '/timetable', '/settings'];

/** Collects every Content-Security-Policy violation the page reports, from events and the console. */
async function watchCsp(page: Page) {
  const violations: string[] = [];
  await page.exposeFunction('reportCspViolation', (v: string) => violations.push(v));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) =>
      (window as unknown as { reportCspViolation(v: string): void }).reportCspViolation(
        `${location.pathname}: ${e.violatedDirective} blocked ${e.blockedURI}`,
      ),
    );
  });
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(`${page.url()}: ${m.text()}`);
  });
  return violations;
}

test('the main pages load without Content-Security-Policy violations', async ({ page, seed }) => {
  const violations = await watchCsp(page);

  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in to your school' })).toBeVisible();
  // The watcher sees a real violation: plain-http images from elsewhere are blocked.
  await page.evaluate((probe) => {
    new Image().src = `http://${probe}/pixel.png`;
  }, PROBE);
  await expect.poll(() => violations.filter((v) => v.includes(PROBE)).length).toBeGreaterThan(0);
  await page.goto('/platform/login');
  await expect(page.getByRole('button', { name: /Sign in/ })).toBeVisible();

  await signIn(page, seed.school.slug, seed.school.ownerEmail, seed.school.password, '/dashboard');
  for (const path of SCHOOL_PAGES) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForLoadState('networkidle');
  }

  await signIn(page, seed.school.slug, seed.parent.phone, seed.parent.password, '/parent');
  await expect(page.getByRole('heading', { name: seed.child.name })).toBeVisible();
  await page.waitForLoadState('networkidle');

  expect(violations.filter((v) => !v.includes(PROBE))).toEqual([]);
});
