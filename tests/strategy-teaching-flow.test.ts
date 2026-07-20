import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const builder = readFileSync(new URL('../components/StrategyBuilder.tsx', import.meta.url), 'utf8');
const rules = readFileSync(new URL('../components/RuleBuilder.tsx', import.meta.url), 'utf8');
const profile = readFileSync(new URL('../app/profile/page.tsx', import.meta.url), 'utf8');
const saveRoute = readFileSync(new URL('../app/api/strategies/save/route.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/029_external_strategy_rule_mode.sql', import.meta.url), 'utf8');

test('Strategy Builder is framed as a conversation that teaches Trade Police', () => {
  assert.match(profile, /Teach Trade Police How You Trade/);
  assert.match(builder, /What do you call the way you trade\?/);
  assert.match(builder, /What do you trade\?/);
  assert.match(builder, /What must you see before taking the trade\?/);
});

test('every evidence rule can be classified without a not-available save blocker', () => {
  assert.match(rules, /Automatic/);
  assert.match(rules, /Manual/);
  assert.match(rules, /External/);
  assert.doesNotMatch(rules, /not available/i);
  assert.doesNotMatch(builder, /unsupportedLiveRules|Disable rules not available/);
});

test('external mode persists while legacy missing modes still default to automatic', () => {
  assert.match(saveRoute, /'AUTOMATIC','MANUAL','EXTERNAL'/);
  assert.match(migration, /evaluation_mode in \('AUTOMATIC','MANUAL','EXTERNAL'\)/);
  assert.match(builder, /row\.evaluation_mode\?\?'AUTOMATIC'/);
});
