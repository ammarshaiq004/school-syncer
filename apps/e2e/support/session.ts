import { expect, type Page } from '@playwright/test';
import { schoolLogin } from './api';

/** Signs in through the login form, as a person would. */
export async function signInWithForm(page: Page, schoolSlug: string, login: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('School code').fill(schoolSlug);
  await page.getByLabel('Email, phone or username').fill(login);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/**
 * Signs in through the API and hands the token to the page, then opens
 * `path`. Quicker than the form for tests that are about something else.
 */
export async function signIn(page: Page, schoolSlug: string, login: string, password: string, path: string) {
  const token = await schoolLogin(schoolSlug, login, password);
  await page.goto('/login');
  await page.evaluate((t) => localStorage.setItem('schoolsyncer.token', t), token);
  await page.goto(path);
  await expect(page).toHaveURL(new RegExp(`${path.replace(/[/?]/g, '\\$&')}`));
  return token;
}
