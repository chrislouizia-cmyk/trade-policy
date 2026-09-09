import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const validator = readFileSync(new URL('../components/TradeValidator.tsx', import.meta.url), 'utf8');
const hero = readFileSync(new URL('../components/decision/DecisionHero.tsx', import.meta.url), 'utf8');

test('Validate ends with a compact strategy-scoped activity preview instead of duplicating History', () => {
  assert.match(validator, /STRATEGY ACTIVITY/);
  assert.match(validator, /Recent setups · \{strategy\.name\}/);
  assert.match(validator, /latestTradeActivity\(history,'SUGGESTED'\)/);
  assert.match(validator, /latestTradeActivity\(history,'EXECUTED'\)/);
  assert.match(validator, /\.eq\('strategy_profile_id',strategy\.id\)/);
  assert.match(validator, /function StrategyTradeActivity\(/);
  assert.match(hero, /View History/);
  assert.match(validator, /window\.location\.href='\/history'/);
  assert.match(validator, /href="\/history">View all history/);
});

test('removing the visible history preview preserves lifecycle state', () => {
  assert.match(validator, /const \[history,setHistory\]=useState<SavedSetup\[]>\(\[\]\)/);
  assert.match(validator, /void loadHistory\(\)/);
  assert.match(validator, /const closedTrades=useMemo\(\(\)=>history\.filter/);
  assert.match(validator, /const hasActiveTrade=useMemo\(\(\)=>history\.some/);
  assert.match(validator, /await loadHistory\(\)/);
});

test('the completed Validate surface keeps every canonical action', () => {
  for (const action of ['Check current market', 'Run Final Risk Check', 'Take Trade', 'Take Anyway', 'Mark as missed']) {
    assert.match(`${validator}\n${hero}`, new RegExp(action, 'i'));
  }
  assert.match(validator, /saveTakenTrade\('ACTIVATE'\)/);
  assert.match(validator, /saveTakenTrade\('OVERRIDE'\)/);
  assert.match(validator, /markTradeMissed\(\)/);
});
