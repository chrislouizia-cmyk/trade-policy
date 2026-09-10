import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const header=fs.readFileSync('components/AppHeader.tsx','utf8');
const dashboard=fs.readFileSync('app/dashboard/page.tsx','utf8');
const dashboardComponent=fs.readFileSync('components/Dashboard.tsx','utf8');
const validate=fs.readFileSync('app/validate/page.tsx','utf8');
const analytics=fs.readFileSync('app/analytics/page.tsx','utf8');
const css=fs.readFileSync('app/product-premium.css','utf8');

test('dashboard greeting lives inside AppHeader above navigation',()=>{
  const greeting=header.indexOf('canonical-dashboard-greeting');
  const nav=header.indexOf('canonical-visible-nav');
  assert.ok(greeting>=0);
  assert.ok(nav>greeting);
  assert.match(dashboard,/showGreeting showContext/);
  assert.doesNotMatch(dashboardComponent,/dashboard-welcome/);
});

test('context switchers are opt-in rather than global',()=>{
  assert.match(header,/showContext = false/);
  assert.match(header,/showContext \? \(/);
  assert.match(dashboard,/showContext/);
  assert.match(validate,/decisionFocused showContext/);
  assert.doesNotMatch(analytics,/showContext/);
});

test('account and strategy switchers remain canonical controls',()=>{
  assert.match(header,/<ActiveAccountSwitcher \/>/);
  assert.match(header,/<ActiveStrategySwitcher \/>/);
});

test('navigation remains fully explicit and visible',()=>{
  assert.match(header,/canonical-visible-nav/);
  assert.match(css,/flex-wrap:wrap!important/);
  assert.match(css,/overflow:visible!important/);
});

test('secondary authenticated pages do not opt into context by default',()=>{
  for(const path of ['app/active-trade/page.tsx','app/accounts/page.tsx','app/profile/page.tsx','app/history/page.tsx','app/analytics/page.tsx','app/account/page.tsx']){
    if(!fs.existsSync(path)) continue;
    const source=fs.readFileSync(path,'utf8');
    assert.doesNotMatch(source,/showContext/);
    assert.doesNotMatch(source,/showGreeting/);
  }
});
