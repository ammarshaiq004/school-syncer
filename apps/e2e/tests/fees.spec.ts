import { expect, test } from '../support/fixtures';
import { today } from '../support/seed';
import { signIn } from '../support/session';

// One voucher's story: generated, paid at the counter, printed, then the payment reversed.
test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page, seed }) => {
  await signIn(page, seed.school.slug, seed.school.ownerEmail, seed.school.password, '/fees');
});

test("generates this month's vouchers", async ({ page }) => {
  const month = today().slice(0, 7);
  await page.getByRole('button', { name: 'Generate vouchers' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Generate vouchers' });
  await dialog.getByLabel('Month').fill(month);
  await dialog.getByRole('button', { name: 'Generate vouchers' }).click();
  await expect(page.getByText('Vouchers generated')).toBeVisible();

  await page.getByRole('textbox', { name: 'Month' }).fill(month);
  const vouchers = page.getByRole('table', { name: 'Fee vouchers' });
  await expect(vouchers.getByRole('row', { name: /Hira Khan/ })).toBeVisible();
  await expect(vouchers.getByRole('row', { name: /Zara Ahmed/ })).toBeVisible();
});

test('records a counter payment and prints the voucher', async ({ page }) => {
  await openHirasVoucher(page);
  // The header button (the empty Payments card offers the same).
  await page.getByRole('button', { name: 'Record payment' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Record payment' });
  await dialog.getByLabel('Amount (Rs)').fill('2000');
  await dialog.getByLabel('Method').selectOption({ label: 'Cash' });
  await dialog.getByRole('button', { name: 'Save payment' }).click();
  await expect(page.getByText('Payment recorded')).toBeVisible();
  // The receipt is listed under Payments, ready to reverse.
  await expect(page.getByText('Rs 2,000').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reverse' })).toBeVisible();

  // "Download invoice PDF" opens the print window, which prints three copies.
  await page.evaluate(() => {
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => void (window as unknown as { printed: number }).printed++;
  });
  await page.getByRole('button', { name: 'Download invoice PDF' }).click();
  expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
  await expect(page.getByText('Bank copy')).toBeHidden();
  await page.emulateMedia({ media: 'print' });
  for (const copy of ['Bank copy', 'School copy', 'Parent copy']) await expect(page.getByText(copy)).toBeVisible();
  await expect(page.getByText('Hira Khan').filter({ visible: true }).first()).toBeVisible();
});

test('reverses the payment with a reason', async ({ page }) => {
  await openHirasVoucher(page);
  await page.getByRole('button', { name: 'Reverse' }).click();
  const dialog = page.getByRole('dialog', { name: 'Reverse this payment?' });
  // A reason is required.
  await dialog.getByRole('button', { name: 'Reverse payment' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Reason').fill('Entered against the wrong student');
  await dialog.getByRole('button', { name: 'Reverse payment' }).click();

  await expect(page.getByText('Payment reversed')).toBeVisible();
  await expect(page.getByText(/^Reversed /)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reverse' })).toHaveCount(0);
  // The full fee is owed again.
  await page.getByRole('button', { name: 'Record payment' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Record payment' }).getByText(/is Rs 4,500\.$/)).toBeVisible();
});

async function openHirasVoucher(page: import('@playwright/test').Page) {
  await page.getByRole('textbox', { name: 'Month' }).fill(today().slice(0, 7));
  await page.getByRole('table', { name: 'Fee vouchers' }).getByRole('row', { name: /Hira Khan/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: /^Voucher / })).toBeVisible();
}
