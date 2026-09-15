import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const header=fs.readFileSync('components/AppHeader.tsx','utf8');
const dashboard=fs.readFileSync('app/dashboard/page.tsx','utf8');
const dashboardComponent=fs.readFileSync('components/Dashboard.tsx','utf8');
const validate=fs.readFileSync('app/validate/page.tsx','utf8');
const activeTrade=fs.readFileSync('app/active-trade/page.tsx','utf8');
const css=fs.readFileSync('app/product-premium.css','utf8');
const mobile=fs.readFileSync('components/MobileBottomNav.tsx','utf8');
const mobileCss=fs.readFileSync('app/mobile-shell.css','utf8');
const layout=fs.readFileSync('app/layout.tsx','utf8');
const feedback=fs.readFileSync('components/FeedbackWidget.tsx','utf8');

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

test('mobile navigation remains a responsive child of the canonical shell',()=>{
  assert.match(header,/<MobileBottomNav activeTradeCount=\{activeTradeCount\} \/>/);
  assert.match(layout,/import '\.\/mobile-shell\.css'/);
  assert.match(mobileCss,/@media \(max-width: 760px\)/);
  assert.match(mobileCss,/\.canonical-visible-nav\s*\{[\s\S]*display: none !important/);
});

test('mobile More preserves account access and a visible sign-out path',()=>{
  for(const href of ['/profile','/analytics','/accounts','/account']) assert.match(mobile,new RegExp(`href: '${href}'`));
  assert.match(mobile,/<SignOutButton \/>/);
  assert.match(mobile,/event\.key === 'Escape'/);
  assert.match(mobile,/closeButtonRef\.current\?\.focus\(\)/);
});

test('mobile shell styles are isolated from public authentication and HQ surfaces',()=>{
  assert.match(mobileCss,/body:has\(\.mobile-bottom-nav\) \.app-document-content/);
  assert.match(mobileCss,/body:has\(\.mobile-bottom-nav\) \.container/);
  assert.doesNotMatch(mobileCss,/\n  \.container \{/);
  assert.doesNotMatch(mobileCss,/\n  button,\n/);
});

test('mobile authenticated surfaces respect iPhone safe areas and dense content widths',()=>{
  assert.match(mobileCss,/env\(safe-area-inset-top\)/);
  assert.match(mobileCss,/env\(safe-area-inset-bottom\)/);
  assert.match(mobileCss,/\.decision-hero-metrics/);
  assert.match(mobileCss,/\.history-event-detail-grid/);
  assert.match(mobileCss,/\.market-chart-toolbar/);
  assert.match(mobileCss,/\.full-report-modal/);
  assert.match(mobileCss,/overscroll-behavior: contain/);
});

test('mobile header uses a compact mark and two-column context controls',()=>{
  assert.match(header,/mobile-shell-brand/);
  assert.match(header,/trade-police-mark-128\.png/);
  assert.match(mobileCss,/\.canonical-shell-brand\s*\{[\s\S]*display: none !important/);
  assert.match(mobileCss,/\.canonical-context-switchers\s*\{[\s\S]*grid-template-columns: repeat\(2/);
});

test('active trade is forced to one contained column on customer mobile',()=>{
  assert.match(mobileCss,/body:has\(\.mobile-bottom-nav\) \.monitor-layout\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\) !important/);
  assert.match(mobileCss,/\.monitor-layout > \*/);
});

test('feedback leaves the viewport and remains available from More',()=>{
  assert.match(mobileCss,/body:has\(\.mobile-bottom-nav\) \.feedback-fab\s*\{[\s\S]*display: none !important/);
  assert.match(mobile,/trade-police:feedback-open/);
  assert.match(mobile,/Send feedback/);
  assert.match(feedback,/addEventListener\('trade-police:feedback-open'/);
});
