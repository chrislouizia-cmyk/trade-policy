import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
const header=fs.readFileSync('components/AppHeader.tsx','utf8');
const dashboard=fs.readFileSync('components/Dashboard.tsx','utf8');
const css=fs.readFileSync('app/product-premium.css','utf8');

test('primary navigation is explicit rather than hidden behind horizontal discovery',()=>{
  assert.match(header,/canonical-visible-nav/);
  assert.match(css,/flex-wrap:wrap!important/);
  assert.match(css,/overflow:visible!important/);
});
test('all primary destinations remain directly present',()=>{
  for(const href of ['/dashboard','/validate','/active-trade','/accounts','/profile','/history','/analytics','/account']) assert.ok(header.includes(`href="${href}"`));
});
test('dashboard restores human welcome only in dashboard content',()=>{
  assert.match(dashboard,/Good morning/);
  assert.match(dashboard,/p\.displayName/);
  assert.doesNotMatch(header,/Good morning/);
});
test('account strategy and user controls remain intact',()=>{
  assert.match(header,/<ActiveAccountSwitcher \/>/);
  assert.match(header,/<ActiveStrategySwitcher \/>/);
  assert.match(header,/<TradePoliceShield \/>/);
  assert.match(header,/<KeyboardShortcuts \/>/);
  assert.match(header,/<SignOutButton \/>/);
});
test('navigation wraps visibly on narrower screens',()=>{
  assert.match(css,/calc\(25% - 5px\)/);
  assert.match(css,/calc\(50% - 5px\)/);
});
