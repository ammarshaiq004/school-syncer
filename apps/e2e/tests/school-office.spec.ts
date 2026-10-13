import { expect, test } from '../support/fixtures';
import { signIn } from '../support/session';

test.beforeEach(async ({ page, seed }) => {
  await signIn(page, seed.school.slug, seed.school.ownerEmail, seed.school.password, '/dashboard');
});

test('adds a student from the directory', async ({ page, seed }) => {
  await page.goto('/students');
  await page.getByRole('button', { name: 'Add student' }).click();
  const drawer = page.getByRole('dialog', { name: 'New student' });
  await drawer.getByLabel('Class and section').selectOption({ label: seed.sections.taught });
  await drawer.getByLabel('First name').fill('Noor');
  await drawer.getByLabel('Last name').fill('Fatima');
  await drawer.getByLabel('Gender').selectOption('FEMALE');
  await drawer.getByLabel('Guardian name').fill('Imran Fatima');
  await drawer.getByLabel('Guardian phone (WhatsApp)').fill(`0397${seed.run.slice(-6)}1`);
  await drawer.getByRole('button', { name: 'Save student' }).click();

  await expect(page.getByText('Student added')).toBeVisible();
  await expect(drawer).toBeHidden();
  await page.getByRole('searchbox', { name: 'Search name, admission no. or phone' }).fill('Noor');
  await expect(page.getByRole('table', { name: 'Student directory' }).getByRole('link', { name: 'Noor Fatima' })).toBeVisible();
});

test("marks a section's attendance", async ({ page, seed }) => {
  await page.goto('/attendance');
  await page.getByLabel('Class and section').selectOption({ label: seed.sections.taught });
  await page.getByRole('button', { name: 'Mark all present' }).click();
  await page.getByRole('button', { name: 'Absent Sana Malik' }).click();
  await expect(page.getByRole('button', { name: 'Absent Sana Malik' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Save register' }).click();
  await expect(page.getByText('Register saved')).toBeVisible();
  await expect(page.getByText('All changes saved')).toBeVisible();

  // The saved register comes back after a reload.
  await page.reload();
  await page.getByLabel('Class and section').selectOption({ label: seed.sections.taught });
  await expect(page.getByRole('button', { name: 'Absent Sana Malik' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Present Hira Khan' })).toHaveAttribute('aria-pressed', 'true');
});
