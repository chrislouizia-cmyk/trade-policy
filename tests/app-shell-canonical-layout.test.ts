import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const header=fs.readFileSync('components/AppHeader.tsx','utf8');
const shell=fs.readFileSync('components/AuthenticatedAppShell.tsx','utf8');
const dashboard=fs.readFileSync('app/dashboard/page.tsx','utf8');
const dashboardComponent=fs.readFileSync('components/Dashboard.tsx','utf8');
const validate=fs.readFileSync('app/validate/page.tsx','utf8');
const activeTrade=fs.readFileSync('app/active-trade/page.tsx','utf8');
const css=fs.readFileSync('app/product-premium.css','utf8');
const mobile=fs.readFileSync('components/MobileBottomNav.tsx','utf8');
const mobileCss=fs.readFileSync('app/mobile-shell.css','utf8');
const glassCss=fs.readFileSync('app/liquid-glass.css','utf8');
const primaryNav=fs.readFileSync('components/AppPrimaryNavigation.tsx','utf8');
const layout=fs.readFileSync('app/layout.tsx','utf8');
const feedback=fs.readFileSync('components/FeedbackWidget.tsx','utf8');
const liveMarket=fs.readFileSync('components/LiveMarketPanel.tsx','utf8');

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

test('desktop and iPad navigation keep every destination in one aligned row',()=>{
  assert.match(header,/<AppPrimaryNavigation activeTradeCount=\{activeTradeCount\} \/>/);
  for(const key of ['nav.dashboard','nav.decision','nav.activeTrade','nav.history','nav.strategies','nav.analytics','nav.tradingAccounts','nav.account']) {
    assert.match(primaryNav,new RegExp(`labelKey: '${key}'`));
  }
  assert.doesNotMatch(primaryNav,/desktop-more-nav/);
  assert.match(glassCss,/grid-template-columns: repeat\(8, minmax\(0, 1fr\)\) !important/);
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
  assert.match(shell,/<MobileBottomNav activeTradeCount=\{activeTradeCount\} \/>/);
  assert.doesNotMatch(header,/MobileBottomNav|FeedbackWidget|createClient/);
  assert.match(layout,/import '\.\/mobile-shell\.css'/);
  assert.match(mobileCss,/@media \(max-width: 760px\)/);
  assert.match(mobileCss,/\.canonical-visible-nav\s*\{[\s\S]*display: none !important/);
});

test('authenticated routes use one shell instead of mounting header and navigation independently',()=>{
  const routes = [
    'app/dashboard/page.tsx',
    'app/validate/page.tsx',
    'app/active-trade/page.tsx',
    'app/history/page.tsx',
    'app/history/[reportId]/page.tsx',
    'app/analytics/page.tsx',
    'app/profile/page.tsx',
    'app/strategies/[id]/page.tsx',
    'app/accounts/page.tsx',
    'app/account/page.tsx',
    'app/account/affiliate/page.tsx',
    'app/share/strategy/[code]/page.tsx',
  ];
  for (const path of routes) {
    const source=fs.readFileSync(path,'utf8');
    assert.match(source,/AuthenticatedAppShell/,`${path} must use the shared shell`);
    assert.doesNotMatch(source,/<AppHeader/,`${path} must not mount its own header`);
  }
  assert.match(shell,/<AppHeader/);
  assert.match(shell,/<div className="authenticated-shell-content">/);
  assert.match(shell,/<FeedbackWidget userId=\{userId\} \/>/);
});

test('the shared shell owns viewport height safe spacing and document layers',()=>{
  assert.match(mobileCss,/\.authenticated-app-shell[\s\S]*min-height: 100dvh/);
  assert.match(mobileCss,/\.authenticated-app-shell > \.canonical-app-shell[\s\S]*z-index: 40/);
  assert.match(mobileCss,/\.mobile-more-backdrop[\s\S]*z-index: 100/);
  assert.match(mobileCss,/\.mobile-bottom-nav[\s\S]*z-index: 80/);
  assert.match(mobileCss,/\.authenticated-app-shell[\s\S]*padding-bottom: calc\(var\(--mobile-bottom-nav-height\)/);
  assert.match(layout,/\{children\}<AppFooter \/>/);
});

test('mobile More preserves account access and a visible sign-out path',()=>{
  for(const href of ['/profile','/analytics','/accounts','/account']) assert.match(mobile,new RegExp(`href: '${href}'`));
  assert.match(mobile,/<SignOutButton \/>/);
  assert.match(mobile,/event\.key === 'Escape'/);
  assert.match(mobile,/closeButtonRef\.current\?\.focus\(\)/);
});

test('mobile Liquid Glass dock keeps four stable actions and tracks the pointer',()=>{
  assert.match(mobile,/labelKey: 'nav.decision'/);
  assert.match(mobile,/labelKey: 'nav.activeTrade'/);
  assert.match(mobile,/labelKey: 'nav.history'/);
  assert.match(mobile,/<h2>\{t\('nav.more'\)\}<\/h2>/);
  const primaryItems=mobile.match(/const primaryItems = \[([\s\S]*?)\] as const/)?.[1]??'';
  assert.doesNotMatch(primaryItems,/nav\.history/);
  assert.doesNotMatch(mobile,/mobile-nav-secondary/);
  assert.match(mobile,/mobile-liquid-selection/);
  assert.match(mobile,/onPointerDown=\{handlePointerDown\}/);
  assert.match(mobile,/onPointerMove=\{handlePointerMove\}/);
  assert.match(mobile,/document\.elementFromPoint/);
  assert.match(glassCss,/grid-template-columns: repeat\(4, minmax\(0, 1fr\)\) !important/);
  assert.match(glassCss,/transform: translateX\(calc\(var\(--liquid-index\)/);
  assert.match(glassCss,/touch-action: none/);
});

test('mobile dock hides page content below its closed visual base',()=>{
  assert.match(mobile,/mobile-nav-backplate/);
  assert.match(glassCss,/\.mobile-nav-backplate\s*\{[\s\S]*position: fixed;[\s\S]*background: linear-gradient/);
  assert.match(glassCss,/\.mobile-more-backdrop\s*\{[\s\S]*rgba\(3, 6, 10, \.94\)/);
});

test('last-loaded glass CSS cannot restore the desktop header navigation on iPhone',()=>{
  assert.match(glassCss,/@media \(max-width: 760px\) \{[\s\S]*?\.canonical-visible-nav \{ display: none !important; \}/);
});

test('iPhone glass avoids Safari fixed-background and nested-card blur artifacts',()=>{
  assert.doesNotMatch(glassCss,/background-attachment: fixed/);
  assert.match(glassCss,/@media \(max-width: 760px\) \{[\s\S]*?body:has\(\.mobile-bottom-nav\) \.card,[\s\S]*?backdrop-filter: none !important/);
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

test('mobile header uses the transparent wordmark and progressive context controls',()=>{
  assert.match(header,/mobile-shell-brand/);
  assert.match(header,/trade-police-logo\.png/);
  assert.match(mobileCss,/\.canonical-shell-brand\s*\{[\s\S]*display: none !important/);
  assert.match(header,/<details className="context-bar compact-context-bar canonical-context-bar" open=\{decisionFocused \|\| undefined\}>/);
  assert.match(header,/Trading context/);
  assert.match(mobileCss,/\.canonical-context-bar:not\(\[open\]\) \.canonical-context-switchers/);
});

test('iPhone viewport and overlays respect browser chrome and chart content',()=>{
  assert.match(layout,/viewportFit: 'cover'/);
  assert.match(mobileCss,/body:has\(\.mobile-bottom-nav\)::before/);
  assert.match(liveMarket,/market-chart-composition/);
  assert.match(mobileCss,/\.market-active-trade-overlay\s*\{[\s\S]*position: static !important/);
});

test('mobile history and strategy detail avoid blank and oversized inherited layouts',()=>{
  assert.match(mobileCss,/\.history-journal-row\s*\{[\s\S]*content-visibility: visible !important/);
  assert.match(mobileCss,/\.strategy-detail-tabs\s*\{[\s\S]*repeat\(3/);
  assert.match(mobileCss,/\.strategy-detail-panel,[\s\S]*height: auto !important/);
});

test('mobile dashboard leads with one primary action and progressively discloses education',()=>{
  assert.match(dashboardComponent,/dashboard-mobile-disclosure/);
  assert.match(dashboardComponent,/How decisions work/);
  assert.match(mobileCss,/\.dashboard-hero-copy > \.eyebrow/);
  assert.match(mobileCss,/\.compact-dashboard-grid\s*\{[\s\S]*repeat\(2/);
  assert.match(mobileCss,/\.workspace-summary\s*\{[\s\S]*display: none !important/);
});

test('mobile visual system is calm and edge anchored',()=>{
  assert.match(mobileCss,/--mobile-surface:/);
  assert.match(mobileCss,/background: linear-gradient\(145deg, rgba\(18,24,33,\.88\), rgba\(11,16,23,\.8\)\) !important/);
  assert.match(mobileCss,/\.mobile-bottom-nav\s*\{[\s\S]*left: 0;[\s\S]*right: 0;[\s\S]*bottom: 0;/);
});

test('mobile glass system keeps high-opacity readable surfaces',()=>{
  assert.match(mobileCss,/--mobile-glass-strong: rgba\(8,13,20,\.92\)/);
  assert.match(mobileCss,/backdrop-filter: blur\(22px\) saturate\(135%\)/);
  assert.match(mobileCss,/backdrop-filter: blur\(28px\) saturate\(145%\)/);
  assert.match(mobileCss,/inset 0 1px 0 var\(--mobile-glass-highlight\)/);
  assert.match(mobileCss,/prefers-reduced-transparency: reduce/);
});

test('liquid glass is shared by desktop iPad and iPhone authenticated surfaces',()=>{
  assert.match(layout,/import '\.\/liquid-glass\.css'/);
  assert.match(glassCss,/body:has\(\.mobile-bottom-nav\) \.canonical-app-shell/);
  assert.match(glassCss,/body:has\(\.mobile-bottom-nav\) \.card/);
  assert.match(glassCss,/min-width: 761px\) and \(max-width: 1024px/);
  assert.match(glassCss,/@media \(max-width: 760px\)/);
  assert.match(glassCss,/backdrop-filter: blur\(30px\) saturate\(155%\)/);
  assert.match(glassCss,/prefers-reduced-transparency: reduce/);
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
