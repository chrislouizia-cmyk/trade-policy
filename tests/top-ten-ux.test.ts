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
  assert.match(pricing,/20 market checks each month/);
  assert.match(pricing,/Up to 10 active strategies/);
  assert.match(pricing,/same deterministic decision logic/);
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

test('decision surface makes source and freshness prominent',()=>{
  const hero=read('components/decision/DecisionHero.tsx');
  assert.match(hero,/Market data · \$\{analysis\.provider\}/);
  assert.match(hero,/latestCandleTimestamp/);
  assert.match(hero,/decision calculated/);
});

test('recording against a verdict is buried and cannot alter the result',()=>{
  const validator=read('components/TradeValidator.tsx');
  assert.match(validator,/Advanced: record against this result/);
  assert.match(validator,/It does not change or approve the decision/);
  assert.doesNotMatch(validator,/>Take anyway</);
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
