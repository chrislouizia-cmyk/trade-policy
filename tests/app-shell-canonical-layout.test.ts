import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const header=fs.readFileSync('components/AppHeader.tsx','utf8');
const dashboard=fs.readFileSync('app/dashboard/page.tsx','utf8');
const dashboardComponent=fs.readFileSync('components/Dashboard.tsx','utf8');
const validate=fs.readFileSync('app/validate/page.tsx','utf8');
const activeTrade=fs.readFileSync('app/active-trade/page.tsx','utf8');
const css=fs.readFileSync('app/product-premium.css','utf8');

test('context exists only on Dashboard Decision and Active Trade',()=>{
  assert.match(dashboard,/showContext/);
  assert.match(validate,/showContext/);
  assert.match(activeTrade,/showContext/);
  for(const path of ['app/accounts/page.tsx','app/profile/page.tsx','app/history/page.tsx','app/analytics/page.tsx','app/account/page.tsx']){
    if(!fs.existsSync(path)) continue;
    assert.doesNotMatch(fs.readFileSync(path,'utf8'),/showContext/);
  }
});

test('dashboard welcome stays below the header to preserve geometry',()=>{
  assert.match(dashboardComponent,/dashboard-welcome/);
  assert.match(dashboardComponent,/Good morning/);
  assert.doesNotMatch(header,/showGreeting/);
  assert.doesNotMatch(header,/canonical-dashboard-greeting/);
});

test('primary navigation stays explicit and fully visible',()=>{
  assert.match(header,/canonical-visible-nav/);
  assert.match(css,/flex-wrap:wrap!important/);
  assert.match(css,/overflow:visible!important/);
});

test('premium polish is visual only and scoped to authenticated container',()=>{
  assert.match(css,/S10 FINAL - premium authenticated product surface/);
  assert.match(css,/\.container \.canonical-app-shell/);
  assert.match(css,/backdrop-filter:blur\(18px\)/);
  assert.match(css,/\.container \.canonical-visible-nav/);
  assert.match(css,/\.container \.canonical-context-bar/);
});

test('account strategy and user controls remain untouched in AppHeader',()=>{
  assert.match(header,/<ActiveAccountSwitcher \/>/);
  assert.match(header,/<ActiveStrategySwitcher \/>/);
  assert.match(header,/<TradePoliceShield \/>/);
  assert.match(header,/<KeyboardShortcuts \/>/);
  assert.match(header,/<SignOutButton \/>/);
});
