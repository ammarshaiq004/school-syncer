import { expect, test } from '../support/fixtures';
import { signIn } from '../support/session';

test.beforeEach(async ({ page, seed }) => {
  await signIn(page, seed.school.slug, seed.school.ownerEmail, seed.school.password, '/dashboard');
});

test('the dashboard shows the new school-at-a-glance cards', async ({ page }) => {
  for (const title of ['Boys and girls', 'Admissions and withdrawals', 'Birthdays today', 'Voucher status', 'Expenses', "Today's fee commitments"]) {
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
  }
});

test('"Add student" on the dashboard opens the new student form', async ({ page }) => {
  await page.getByRole('link', { name: /Add student/ }).first().click();
  await expect(page).toHaveURL(/\/students\?add=1/);
  await expect(page.getByRole('dialog', { name: 'New student' })).toBeVisible();
});

test('an internal note is kept on the student file', async ({ page }) => {
  await page.goto('/students');
  await page.getByRole('table', { name: 'Student directory' }).getByRole('link').first().waitFor();
  await page.getByRole('table', { name: 'Student directory' }).locator('tbody tr').first().click();
  const drawer = page.getByRole('dialog');
  await drawer.getByRole('tab', { name: 'Documents & notes' }).click();
  await drawer.getByLabel('New note').fill('Father asked for a fee extension');
  await drawer.getByRole('button', { name: 'Add note' }).click();
  await expect(drawer.getByText('Father asked for a fee extension')).toBeVisible();
});

test('the syllabus tab lists classes and subjects', async ({ page }) => {
  await page.goto('/lesson-plans');
  await page.getByRole('tab', { name: 'Syllabus' }).click();
  await expect(page.getByRole('table', { name: 'Syllabus progress' })).toBeVisible();
});
