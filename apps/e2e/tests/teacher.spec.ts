import { expect, test } from '../support/fixtures';
import { signInWithForm } from '../support/session';

test('a teacher sees only their sections and enters marks', async ({ page, seed }) => {
  await signInWithForm(page, seed.school.slug, seed.teacher.phone, seed.teacher.password);
  await expect(page).toHaveURL(/\/dashboard$/);

  // Only the section they teach is offered for the register.
  await page.goto('/attendance');
  const sections = page.getByLabel('Class and section');
  await expect(sections.getByRole('option', { name: seed.sections.taught })).toHaveCount(1);
  await expect(sections.getByRole('option', { name: seed.sections.other })).toHaveCount(0);

  await page.goto(`/exams/${seed.exam.id}`);
  await expect(page.getByRole('heading', { level: 1, name: seed.exam.name })).toBeVisible();
  const sheets = page.getByRole('table', { name: 'Marks sheets' });
  await expect(sheets.getByRole('row', { name: new RegExp(seed.sections.other) })).toHaveCount(0);
  await sheets.getByRole('row', { name: /Mathematics/ }).getByRole('button', { name: 'Enter marks' }).click();

  await page.getByLabel('Marks for Hira Khan').fill('42');
  await page.getByLabel('Marks for Sana Malik').fill('15');
  await page.getByRole('button', { name: 'Save marks' }).click();
  await expect(page.getByText('Marks saved')).toBeVisible();
  await expect(page.getByText('Saved marks for 2 students.')).toBeVisible();
});
