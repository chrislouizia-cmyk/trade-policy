import { expect, test } from '@playwright/test';

test.describe('Client authentication contract', () => {
  test('public landing page loads', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText('TRADE POLICE').first()).toBeVisible();
  });

  test('default client auth opens in sign-in mode', async ({ page }) => {
    await page.goto('/client/login');

    await expect(
      page.getByRole('heading', { name: 'Sign in' })
    ).toBeVisible();
  });

  test('signup mode opens in create-account mode', async ({ page }) => {
    await page.goto('/client/login?mode=signup');

    await expect(
      page.getByRole('heading', { name: 'Create account' })
    ).toBeVisible();
  });

  const protectedRoutes = [
    ['/validate', '/validate'],
    ['/profile', '/profile'],
    ['/accounts', '/accounts'],
    ['/analytics', '/analytics'],
    ['/active-trade', '/active-trade'],
  ] as const;

  for (const [route, expectedNext] of protectedRoutes) {
    test(`${route} redirects unauthenticated users to canonical client login`, async ({
      page,
    }) => {
      await page.goto(route);

      await expect(page).toHaveURL(/\/client\/login/);

      const destination = new URL(page.url());

      expect(destination.pathname).toBe('/client/login');
      expect(destination.searchParams.get('next')).toBe(expectedNext);
    });
  }
});
