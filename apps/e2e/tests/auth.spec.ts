import { expect, test } from '../support/fixtures';
import { call, schoolLogin } from '../support/api';
import { withDb } from '../support/db';
import { signInWithForm } from '../support/session';

test('an owner with an issued password must choose their own before using the app', async ({ page, seed }) => {
  await signInWithForm(page, seed.fresh.slug, seed.fresh.ownerEmail, seed.fresh.temporaryPassword);
  await expect(page).toHaveURL(/\/change-password$/);
  await expect(page.getByRole('heading', { name: 'Choose your password' })).toBeVisible();

  // The rest of the app stays out of reach until the password is replaced.
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/change-password$/);

  await page.getByLabel('Password you were given').fill(seed.fresh.temporaryPassword);
  await page.getByLabel(/^New password/).fill('Fresh-owner-42');
  await page.getByLabel('Repeat new password').fill('Fresh-owner-42');
  await page.getByRole('button', { name: 'Save password' }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { level: 1, name: /Fresh/ })).toBeVisible();
  // The issued password no longer works; the new one does.
  await expect(schoolLogin(seed.fresh.slug, seed.fresh.ownerEmail, seed.fresh.temporaryPassword)).rejects.toThrow(/401/);
  await schoolLogin(seed.fresh.slug, seed.fresh.ownerEmail, 'Fresh-owner-42');
});

test('the owner signs in and the dashboard loads', async ({ page, seed }) => {
  await signInWithForm(page, seed.school.slug, seed.school.ownerEmail, seed.school.password);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { level: 1, name: /Owner/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Active students \d+/ })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Fee management' })).toBeVisible();
});

test('a revoked session sends the browser back to sign in', async ({ page, seed }) => {
  const owner = await schoolLogin(seed.school.slug, seed.school.ownerEmail, seed.school.password);
  const phone = `0398${seed.run.slice(-6)}9`;
  const user = await call('POST', '/users', {
    token: owner,
    body: { name: 'Revoked Admin', phone, password: 'Issued-pass-1', roles: [{ role: 'ADMIN' }] },
  });
  await withDb((db) => db.user.update({ where: { id: user.id }, data: { mustChangePassword: false } }));

  await signInWithForm(page, seed.school.slug, phone, 'Issued-pass-1');
  await expect(page).toHaveURL(/\/dashboard$/);

  // The owner resets this person's password, which ends their sessions.
  await call('POST', `/users/${user.id}/reset-password`, { token: owner, body: {} });

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Student directory' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Sign in to your school' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('schoolsyncer.token'))).toBeNull();
});
