import { expect, test } from '../support/fixtures';
import { signIn } from '../support/session';

// SCHOOL-150 pilot kit: report a problem, the owner's setup checklist, the
// parallel-run sheets and the console inbox.

const reportText = (run: string) => `The register page froze after saving (pilot e2e ${run})`;

test('the owner reports a problem from any page and follows it', async ({ page, seed }) => {
  const message = reportText(seed.run);
  await signIn(page, seed.school.slug, seed.school.ownerEmail, seed.school.password, '/attendance');
  await page.getByRole('button', { name: 'Report a problem' }).click();
  const panel = page.getByRole('dialog', { name: 'Report a problem' });
  await expect(panel.getByText('/attendance')).toBeVisible();
  await panel.getByLabel('What went wrong?').fill(message);
  await panel.getByRole('button', { name: 'Send report' }).click();
  await expect(page.getByText('Report sent')).toBeVisible();
  // It lands on "My reports", new.
  const mine = panel.getByRole('list', { name: 'Your reports' });
  await expect(mine.getByText(message)).toBeVisible();
  await expect(mine.getByText('New').first()).toBeVisible();
});

test('the owner sees the setup checklist and can hide it', async ({ page, seed }) => {
  await signIn(page, seed.school.slug, seed.school.ownerEmail, seed.school.password, '/dashboard');
  const steps = page.getByRole('list', { name: 'Setup steps' });
  await expect(steps).toBeVisible();
  await expect(steps.getByRole('link', { name: /Students imported/ })).toHaveAttribute('href', '/students/import');
  await expect(steps.getByRole('link', { name: /Messaging sender/ })).toHaveAttribute('href', '/settings?tab=messaging');
  await page.getByRole('button', { name: 'Hide' }).click();
  await expect(steps).toBeHidden();
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Setup steps' })).toBeHidden();
});

// The seed marks one register in the other section today.
test('the parallel-run sheets show attendance per section per day', async ({ page, seed }) => {
  await signIn(page, seed.school.slug, seed.school.ownerEmail, seed.school.password, '/reports/parallel-run');
  await expect(page.getByRole('heading', { level: 1, name: 'Parallel-run check' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Collected per day' }).or(page.getByText('No fees collected in these dates'))).toBeVisible();
  await page.getByRole('tab', { name: 'Attendance' }).click();
  await expect(page.getByRole('heading', { name: 'Per section per day' })).toBeVisible();
  await expect(page.getByRole('cell', { name: seed.sections.other, exact: true })).toBeVisible();
});

test('SchoolSyncer staff triage the report in the console', async ({ page, seed }) => {
  const message = reportText(seed.run);
  await page.goto('/platform/login');
  await page.getByLabel('Email').fill(seed.consoleAdmin.email);
  await page.getByLabel('Password').fill(seed.consoleAdmin.password);
  await page.getByRole('button', { name: /Sign in/ }).click();
  await expect(page).toHaveURL(/\/platform$/);

  await page.getByRole('link', { name: 'Problem reports' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Problem reports' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search reports' }).fill(message);
  await page.getByText(message).click();
  const drawer = page.getByRole('dialog', { name: /Report from/ });
  await expect(drawer.getByText('/attendance')).toBeVisible();
  await drawer.getByRole('radio', { name: 'In progress' }).click();
  await expect(drawer.getByRole('radio', { name: 'In progress' })).toHaveAttribute('aria-checked', 'true');
  await drawer.getByLabel('Internal note').fill('Could not reproduce on Chrome yet');
  await drawer.getByRole('button', { name: 'Add note' }).click();
  await expect(drawer.getByText('Could not reproduce on Chrome yet')).toBeVisible();
});
