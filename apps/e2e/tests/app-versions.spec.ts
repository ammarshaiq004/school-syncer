import { expect, test } from '../support/fixtures';
import { API_URL } from '../support/env';

const android = (version: string) => ({ 'X-App-Platform': 'android', 'X-App-Version': version });

test('a console owner raises the Android minimum and outdated app builds get 426', async ({ page, seed }) => {
  await page.goto('/platform/login');
  await page.getByLabel('Email').fill(seed.consoleAdmin.email);
  await page.getByLabel('Password').fill(seed.consoleAdmin.password);
  await page.getByRole('button', { name: /Sign in/ }).click();
  await expect(page).toHaveURL(/\/platform$/);

  await page.getByRole('link', { name: 'Mobile app' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Mobile app' })).toBeVisible();
  const card = page.getByRole('region', { name: 'Android (Google Play)' });
  // Start from the server defaults whatever an earlier run left behind.
  const useDefaults = card.getByRole('button', { name: 'Use defaults' });
  if (await useDefaults.isVisible()) {
    await useDefaults.click();
    await expect(useDefaults).toBeHidden();
  }

  await card.getByLabel('Minimum version').fill('v2');
  await expect(card.getByText('Use a version like 1.4.0')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Save' })).toBeDisabled();

  await card.getByLabel('Minimum version').fill('2.0.0');
  await card.getByLabel('Latest version').fill('2.1.0');
  await card.getByLabel('Message').fill('Fee receipts moved: please update');
  await expect(card.getByText('This locks older builds out')).toBeVisible();
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(card.getByText(/Set in the console by E2E Console/)).toBeVisible();

  const published = await (await fetch(`${API_URL}/app/version`)).json();
  expect(published.android).toMatchObject({ minVersion: '2.0.0', latestVersion: '2.1.0', message: 'Fee receipts moved: please update' });

  // Outdated Android builds are refused before they can sign in; the web is not.
  const login = (headers: Record<string, string>) =>
    fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ schoolSlug: seed.school.slug, login: seed.parent.phone, password: seed.parent.password }),
    });
  const refused = await login(android('1.9.0'));
  expect(refused.status).toBe(426);
  expect(await refused.json()).toMatchObject({ code: 'APP_UPDATE_REQUIRED', minVersion: '2.0.0' });
  expect((await login(android('2.0.0'))).status).toBe(200);
  expect((await login({})).status).toBe(200);

  // The change is in the console audit log.
  await page.goto('/platform/audit');
  await expect(page.getByRole('cell', { name: 'Changed the mobile app versions' }).first()).toBeVisible();

  // Back to the defaults, so nothing else is gated.
  await page.goto('/platform/app-versions');
  await card.getByRole('button', { name: 'Use defaults' }).click();
  await expect(card.getByText('Using the server defaults')).toBeVisible();
  expect((await login(android('1.9.0'))).status).toBe(200);
});

test('the privacy policy is public and linked from sign-in', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Privacy policy' }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy policy' })).toBeVisible();
});
