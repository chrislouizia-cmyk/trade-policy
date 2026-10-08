import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the primary journey exposes five direct mobile destinations and seven desktop destinations', () => {
  const mobile = read('components/MobileBottomNav.tsx');
  const desktop = read('components/AppPrimaryNavigation.tsx');
  const mobileItems = mobile.match(/const primaryItems = \[([\s\S]*?)\] as const/)?.[1] ?? '';
  const desktopItems = desktop.match(/const navigationItems = \[([\s\S]*?)\] as const/)?.[1] ?? '';
  assert.equal((mobileItems.match(/href:/g) ?? []).length, 5);
  assert.equal((desktopItems.match(/href:/g) ?? []).length, 7);
  for (const route of ['/dashboard', '/validate', '/active-trade', '/history', '/profile']) {
    assert.match(mobileItems, new RegExp(route.replace('/', '\\/')));
  }
  assert.doesNotMatch(mobile, /nav\.more|mobile-more-sheet/);
});

test('dashboard presents one contextual primary action without a duplicate action grid', () => {
  const dashboard = read('components/Dashboard.tsx');
  assert.match(dashboard, /Ready to check your next trade/);
  assert.match(dashboard, /Review the trade you already took/);
  assert.match(dashboard, /hasOpenTrade\?'\/active-trade':'\/validate'/);
  assert.doesNotMatch(dashboard, /className="card quick-actions"/);
  assert.doesNotMatch(dashboard, /className="card workspace-summary"/);
});

test('plain-language decisions preserve the internal status and final risk boundary', () => {
  const hero = read('components/decision/DecisionHero.tsx');
  for (const label of ['SETUP FOUND', 'TAKE IT', 'WAIT', "DON'T TAKE IT"]) assert.match(hero, new RegExp(label));
  assert.match(hero, /finalized\?copy\.takeIt:copy\.setupFound/);
  assert.match(hero, /System status/);
  assert.match(hero, /decision-technical-details/);
  assert.match(hero, /Run Final Risk Check/);
});

test('secondary destinations remain reachable without crowding primary navigation', () => {
  const dashboard = read('components/Dashboard.tsx');
  const profile = read('app/profile/page.tsx');
  const account = read('app/account/page.tsx');
  const header = read('components/AppHeader.tsx');
  assert.match(dashboard, /href="\/analytics"/);
  assert.match(profile, /href="\/marketplace"/);
  assert.match(account, /href="\/accounts"/);
  assert.match(header, /href="\/account" className="mobile-account-link"/);
});
