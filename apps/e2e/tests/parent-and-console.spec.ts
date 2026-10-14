import { expect, test } from '../support/fixtures';
import { signInWithForm } from '../support/session';

test("a parent signs in with their phone and sees their child's fees and attendance", async ({ page, seed }) => {
  await signInWithForm(page, seed.school.slug, seed.parent.phone, seed.parent.password);
  await expect(page).toHaveURL(/\/parent$/);
  await expect(page.getByRole('heading', { name: seed.child.name })).toBeVisible();
  await expect(page.getByText('Fees due').first()).toBeVisible();
  // Last month's voucher is unpaid (this month's may be too, once generated).
  await expect(page.getByText(/^[1-9]\d* unpaid vouchers?$/)).toBeVisible();
  await expect(page.getByRole('img', { name: `${seed.child.name} attendance this month: Present 1, Absent 0, Leave 0` })).toBeVisible();

  await page.goto('/parent/invoices');
  await expect(page.getByText(/Rs 4,500/).first()).toBeVisible();

  await page.goto('/parent/attendance');
  await expect(page.getByText('Present').first()).toBeVisible();

  // Staff pages are not theirs.
  await page.goto('/fees');
  await expect(page).not.toHaveURL(/\/fees$/);
});

test('SchoolSyncer staff sign in to the platform console', async ({ page, seed }) => {
  await page.goto('/platform/login');
  await page.getByLabel('Email').fill(seed.consoleAdmin.email);
  await page.getByLabel('Password').fill(seed.consoleAdmin.password);
  await page.getByRole('button', { name: /Sign in/ }).click();
  await expect(page).toHaveURL(/\/platform$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();

  await page.goto('/platform/schools');
  await page.getByRole('searchbox').first().fill(seed.run);
  await expect(page.getByRole('link', { name: `Fresh School ${seed.run}` })).toBeVisible();
});
