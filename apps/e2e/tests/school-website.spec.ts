import { expect, test } from '../support/fixtures';
import { signIn } from '../support/session';

// The school's public website: edited in the portal, drawn live in a preview
// frame, and visible at /s/<slug> only once it is published.

const headline = (run: string) => `Learning that lasts (site e2e ${run})`;

test('the owner edits the site, sees it in the preview, and publishes it', async ({ page, seed }) => {
  const text = headline(seed.run);
  const slug = seed.school.slug;

  // Not published yet: visitors get a not-found page, not a half-made site.
  const before = await page.request.get(`/s/${slug}`);
  expect(before.status()).toBe(404);

  await signIn(page, slug, seed.school.ownerEmail, seed.school.password, '/website');
  await expect(page.getByRole('heading', { level: 1, name: 'School website' })).toBeVisible();
  await expect(page.getByText('Your website is not published')).toBeVisible();

  await page.getByRole('tab', { name: 'Home' }).click();
  await page.getByLabel('Headline').fill(text);

  // The frame draws the unsaved draft.
  const frame = page.frameLocator('iframe[title="Website preview"]');
  await expect(frame.getByRole('heading', { level: 1 })).toContainText('Learning that lasts');

  await page.getByRole('switch', { name: 'Published' }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Website saved and live')).toBeVisible();
  await expect(page.getByText('Your website is live')).toBeVisible();

  const live = await page.request.get(`/s/${slug}`);
  expect(live.status()).toBe(200);
  expect(await live.text()).toContain('Learning that lasts');
});

test('a section reset goes back to the suggested wording', async ({ page, seed }) => {
  const slug = seed.school.slug;
  await signIn(page, slug, seed.school.ownerEmail, seed.school.password, '/website');
  await page.getByRole('tab', { name: 'Home' }).click();
  await expect(page.getByLabel('Headline')).toHaveValue(/Learning that lasts/);
  await page.getByRole('button', { name: 'Use suggested wording' }).click();
  await expect(page.getByLabel('Headline')).not.toHaveValue(/Learning that lasts/);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Website saved', { exact: false })).toBeVisible();
  const live = await page.request.get(`/s/${slug}`);
  expect(await live.text()).not.toContain('Learning that lasts');
});
