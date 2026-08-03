import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(path:string)=>fs.readFileSync(path,'utf8');

test('first-run dashboard and analytics never invent zero-value evidence',()=>{
  const dashboard=read('components/Dashboard.tsx');
  const analytics=read('components/AnalyticsDashboard.tsx');
  assert.match(dashboard,/No closed trades/);
  assert.match(dashboard,/closedTradesToday>0/);
  assert.match(analytics,/Analytics begin after your first closed trade/);
  assert.match(analytics,/will not turn an empty history into percentages/);
});

test('pricing states the real Pro price and exact plan limits',()=>{
  const pricing=read('app/pricing/page.tsx');
  assert.match(pricing,/\$29 \/ month/);
  assert.match(pricing,/30 market checks each month/);
  assert.match(pricing,/Up to 10 active strategies/);
  assert.match(pricing,/same deterministic decision logic/);
});

test('pricing cards keep aligned CTAs and equal desktop card height',()=>{
  const pricing=read('app/pricing/page.tsx');
  const styles=read('app/trade-police.css');
  assert.match(pricing,/Join the waitlist/);
  assert.match(pricing,/plan-cta/);
  assert.match(styles,/\.plan-card\{[^}]*display:flex;[^}]*flex-direction:column/);
  assert.match(styles,/\.plan-card \.plan-cta-wrap\{[^}]*margin-top:auto/);
  assert.match(styles,/\.plan-card \.plan-features\{[^}]*min-height:220px/);
  assert.match(styles,/\.plan-card \.plan-cta\{[^}]*height:48px;[^}]*min-height:48px/);
});

test('starter rules accelerate activation without bypassing review or save',()=>{
  const builder=read('components/StrategyBuilder.tsx');
  assert.match(builder,/Use starter rules/);
  assert.match(builder,/Nothing is active until you save and confirm them/);
  assert.match(builder,/setBuilderStep\('review'\)/);
  assert.match(builder,/onClick=\{\(\) => void save\(\)\}/);
  assert.match(builder,/MethodologyVerification/);
});

test('decision journey uses one clear market-check to risk-check sequence',()=>{
  const market=read('components/LiveMarketPanel.tsx');
  const validator=read('components/TradeValidator.tsx');
  assert.match(market,/STEP 1 · CHECK CURRENT MARKET/);
  assert.match(validator,/STEP 2 · REVIEW TRADE DETAILS/);
  assert.match(validator,/Run final risk check/);
});

test('customer-facing acquisition surfaces use plain trading-rule language',()=>{
  const landing=read('app/page.tsx');
  const profile=read('app/profile/page.tsx');
  const composer=read('components/RuleComposer.tsx');
  assert.match(landing,/YOUR TRADING RULES/);
  assert.match(profile,/TRADE POLICE \/ TRADING RULES/);
  assert.match(composer,/Define your confirmation rules/);
  assert.doesNotMatch(landing,/Strategy DNA/);
});

test('landing page shows an honest illustrative decision report',()=>{
  const landing=read('app/page.tsx');
  assert.match(landing,/EXAMPLE DECISION/);
  assert.match(landing,/Two required confirmations are still missing/);
  assert.match(landing,/Illustrative result · not live market data/);
});

test('landing product walkthrough is lightweight, truthful, and motion-safe',()=>{
  const landing=read('app/page.tsx');
  const demo=read('components/LandingProductDemo.tsx');
  const styles=read('app/trade-police.css');
  assert.match(landing,/LandingProductDemo/);
  assert.match(demo,/Every state is illustrative—not live market data, a signal, or a performance claim/);
  for(const state of ['READY','WAIT','BLOCKED'])assert.match(demo,new RegExp(`verdict:'${state}'`));
  assert.match(demo,/Two required confirmations are still missing/);
  assert.match(demo,/AI may explain this result\. It cannot change the decision/);
  assert.doesNotMatch(demo,/<video|<img|use client|fetch\(/);
  assert.doesNotMatch(demo,/\b(win rate|profit factor|P&L|performance percentage)\b/i);
  assert.match(styles,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(styles,/\.product-demo-frame\{position:static;display:grid;opacity:1;transform:none;animation:none\}/);
});

test('decision surface makes source and freshness prominent',()=>{
  const hero=read('components/decision/DecisionHero.tsx');
  assert.match(hero,/Market data · \$\{analysis\.provider\}/);
  assert.match(hero,/latestCandleTimestamp/);
  assert.match(hero,/decision calculated/);
});

test('trade lifecycle uses explicit take and missed actions with source linkage',()=>{
  const validator=read('components/TradeValidator.tsx');
  const header=read('components/AppHeader.tsx');
  assert.match(validator,/setTradeActionMode\('ACTIVATE'\)/);
  assert.match(validator,/setTradeActionMode\('MISSED'\)/);
  assert.match(validator,/Take trade/);
  assert.match(validator,/Take anyway/);
  assert.match(validator,/Mark as missed/);
  assert.match(validator,/Save setup/);
  assert.match(validator,/Use setup parameters/);
  assert.match(header,/href="\/active-trade"/);
  assert.match(header,/Active Trade/);
  assert.match(validator,/sourceDecisionId:result\.reportSourceId/);
  assert.match(validator,/sourceReportId:result\.reportSourceId/);
});

test('decision card explanation uses the same authorization eligibility as the take flow',()=>{
  const validator=read('components/TradeValidator.tsx');
  assert.match(validator,/authorizationEligibility: result\?\.authorizationEligibility/);
});

test('UX work does not modify deterministic or HQ implementation files',()=>{
  const changed=process.env.UX_CHANGED_FILES?.split('\n').filter(Boolean)??[];
  for(const path of changed){
    assert.equal(path.startsWith('lib/intelligence/'),false,path);
    assert.equal(path.startsWith('lib/market-intelligence/'),false,path);
    assert.equal(path.startsWith('app/hq/'),false,path);
    assert.equal(path.startsWith('components/hq/'),false,path);
  }
});
