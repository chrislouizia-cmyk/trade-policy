import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const header = fs.readFileSync('components/AppHeader.tsx', 'utf8');
const css = fs.readFileSync('app/product-premium.css', 'utf8');

test('authenticated shell has two structural rows', () => {
  assert.match(header, /canonical-shell-top/);
  assert.match(header, /canonical-context-bar/);
  assert.doesNotMatch(header, /client-greeting-row/);
  assert.doesNotMatch(header, /personal-greeting/);
});

test('primary navigation lives in the top shell row', () => {
  const topStart = header.indexOf('canonical-shell-top');
  const contextStart = header.indexOf('canonical-context-bar');
  const nav = header.indexOf('canonical-shell-nav');
  assert.ok(topStart >= 0);
  assert.ok(nav > topStart);
  assert.ok(contextStart > nav);
});

test('account and strategy switchers remain intact', () => {
  assert.match(header, /<ActiveAccountSwitcher \/>/);
  assert.match(header, /<ActiveStrategySwitcher \/>/);
  assert.match(header, /canonical-context-switchers/);
});

test('shell keeps active trade badge and user controls', () => {
  assert.match(header, /activeTradeCount > 0/);
  assert.match(header, /<TradePoliceShield \/>/);
  assert.match(header, /<KeyboardShortcuts \/>/);
  assert.match(header, /<SignOutButton \/>/);
});

test('canonical shell has responsive rules', () => {
  assert.match(css, /Canonical authenticated app shell - S10A/);
  assert.match(css, /\.canonical-shell-top\{/);
  assert.match(css, /@media\(max-width:900px\)/);
  assert.match(css, /@media\(max-width:560px\)/);
});
