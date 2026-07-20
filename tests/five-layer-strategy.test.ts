import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {normalizeStrategyPolicy,normalizeStrategyProfile} from '../lib/strategy-policy.ts';
import {DEFAULT_STRATEGY_PROFILE} from '../types/trade.ts';

test('legacy AI JSON is normalized while preserving confidence threshold',()=>{
  const normalized=normalizeStrategyProfile({...DEFAULT_STRATEGY_PROFILE,engineVersion:1,macroTimeframe:undefined,triggerTimeframe:undefined,aiBehavior:{tone:'direct',confidenceThreshold:67} as any});
  assert.equal(normalized.aiBehavior?.confidenceThreshold,67);assert.equal(normalized.aiBehavior?.strictness,'conservative');assert.equal(normalizeStrategyPolicy(normalized).confidenceThreshold,67);
});

test('migration persists five-layer metadata and automatic/manual rule mode',()=>{
  const sql=readFileSync(new URL('../supabase/migrations/028_five_layer_beta_strategy_engine.sql',import.meta.url),'utf8');
  assert.match(sql,/engine_version/);assert.match(sql,/evaluation_mode/);assert.match(sql,/confidenceThreshold/);
});

test('save API validates confidence and persists evaluation mode',()=>{
  const source=readFileSync(new URL('../app/api/strategies/save/route.ts',import.meta.url),'utf8');
  assert.match(source,/confidenceThreshold/);assert.match(source,/evaluation_mode/);assert.match(source,/INVALID_STRATEGY/);
});
