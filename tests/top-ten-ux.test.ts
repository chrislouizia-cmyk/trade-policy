import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(path:string)=>fs.readFileSync(path,'utf8');

test('first-run dashboard and analytics never invent zero-value evidence',()=>{
  const dashboard=read('components/Dashboard.tsx');
  const analytics=read('components/AnalyticsDashboard.tsx');
  assert.match(dashboard,/No closed trades/);
  assert.match(dashboard,/closedTradesToday>0/);
  assert.match(analytics,/c\.emptyTitle|c\.emptyBody/);
  assert.match(analytics,/c\.emptyBody/);
  assert.match(analytics,/c\.canonicalOnly/);
  assert.doesNotMatch(analytics,/0%|0R|percentages|empty history/i);
});

test('pricing states the real Pro price and exact plan limits',()=>{
  const pricing=read('app/pricing/page.tsx');
  assert.match(pricing,/\$29 \/ month/);
  assert.match(pricing,/250 analyses per anchored monthly cycle/);
  assert.match(pricing,/5 active strategies/);
  assert.match(pricing,/same deterministic decision logic/);
});

test('pricing cards keep aligned CTAs and equal desktop card height',()=>{
  const pricing=read('app/pricing/page.tsx');
  const styles=read('app/trade-police.css');
  assert.match(pricing,/BillingActions/);
  assert.match(pricing,/Contact sales/);
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
  const hero=read('components/decision/DecisionHero.tsx');
  assert.match(market,/STEP 1 · CHECK CURRENT MARKET/);
  assert.match(validator,/STEP 2 · REVIEW TRADE DETAILS/);
  assert.match(hero,/Run Final Risk Check/);
  assert.match(hero,/form="final-risk-check"/);
});

test('customer-facing acquisition surfaces use plain trading-rule language',()=>{
  const landing=read('lib/i18n/landing-copy.ts');
  const composer=read('components/RuleComposer.tsx');
  assert.match(landing,/STRATEGY BUILDER|Build visually|Your strategy|Trading rules/i);
  assert.match(composer,/Define your confirmation rules|Risk/i);
  assert.doesNotMatch(landing,/Strategy DNA/i);
});

test('landing page shows an honest illustrative decision report',()=>{
  const landing=read('app/page.tsx');
  const copy=read('lib/i18n/landing-copy.ts');
  assert.match(landing,/styles\.terminal/);
  assert.match(copy,/One required confirmation is still missing/);
  assert.match(copy,/Decision support, not financial advice/);
});

test('landing product walkthrough is lightweight, truthful, and motion-safe',()=>{
  const landing=read('app/page.tsx');
  const copy=read('lib/i18n/landing-copy.ts');
  const styles=read('app/trade-police-landing.module.css');
  for(const state of ['READY','WAIT','BLOCKED'])assert.match(landing,new RegExp(state));
  assert.match(copy,/AI explains the result/);
  assert.match(copy,/Your rules decide it/);
  assert.doesNotMatch(landing,/<video|use client|fetch\(/);
  assert.doesNotMatch(copy,/guaranteed profits|AI predicts the market/i);
  assert.match(styles,/@media\(prefers-reduced-motion:reduce\)/);
});

test('decision surface makes source and freshness prominent',()=>{
  const hero=read('components/decision/DecisionHero.tsx');
  assert.match(hero,/Market data · \$\{analysis\.provider\}/);
  assert.match(hero,/latestCandleTimestamp/);
  assert.match(hero,/decision calculated/);
});

test('trade validator seeds required form fields before the final risk check can submit',()=>{
  const validator=read('components/TradeValidator.tsx');
  assert.match(validator,/applyDefaultTradeFormValues/);
  assert.match(validator,/accountBalance/);
  assert.match(validator,/riskPercent/);
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
  assert.match(validator,/Apply to order ticket/);
  assert.match(header,/href="\/active-trade"/);
  assert.match(header,/Active Trade/);
  assert.match(validator,/sourceDecisionId:result\.reportSourceId/);
  assert.match(validator,/sourceReportId:reportSave\.reportId \?\? undefined/);
  assert.doesNotMatch(validator,/sourceReportId:result\.reportSourceId/);
});

test('decision card explanation uses the same authorization eligibility as the take flow',()=>{
  const validator=read('components/TradeValidator.tsx');
  assert.match(validator,/authorizationEligibility: result\?\.authorizationEligibility/);
});

test('validation responses expose override eligibility for wait and blocked decisions',()=>{
  const route=read('app/api/validate/route.ts');
  assert.match(route,/allowOverride: true/);
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
