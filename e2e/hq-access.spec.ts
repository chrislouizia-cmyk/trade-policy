import { expect, test } from '@playwright/test';

test.describe('HQ unauthenticated security boundary', () => {
  const protectedRoutes = [
    '/hq',
    '/hq/customers',
    '/hq/staff',
    '/hq/affiliates',
    '/hq/compliance',
    '/hq/support',
  ];

  for (const route of protectedRoutes) {
    test(`${route} cannot be accessed without staff authentication`, async ({ page }) => {
      await page.goto(route);

      const url = new URL(page.url());

      expect(url.pathname).not.toBe(route);

      expect(
        url.pathname === '/hq/login' ||
        url.pathname === '/client/login' ||
        url.pathname === '/login'
      ).toBeTruthy();
    });
  }

  test('HQ login page is reachable', async ({ page }) => {
    await page.goto('/hq/login');

    await expect(page).toHaveURL(/\/hq\/login/);
    await expect(page.locator('body')).toBeVisible();
  });
});
