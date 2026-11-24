import { test, expect } from '@playwright/test';

test('loads, dismisses the safety sheet, and navigates without overflow', async ({ page }) => {
  const errors = [];
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', error => errors.push(error.message));

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Before you start' })).toBeVisible();
  await page.getByRole('button', { name: 'I understand' }).click();

  await expect(page.getByRole('heading', { name: 'Myrtle Creek Nursery' })).toBeVisible();
  await expect(page.getByText('No market day open')).toBeVisible();

  await page.getByRole('link', { name: 'Market day' }).click();
  await expect(page).toHaveURL(/#market$/);

  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth
  }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
  expect(errors).toEqual([]);
});
