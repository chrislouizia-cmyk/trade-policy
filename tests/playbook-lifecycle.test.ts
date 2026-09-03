import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const builder = readFileSync(new URL('../components/StrategyBuilder.tsx', import.meta.url), 'utf8');
const route = readFileSync(new URL('../app/api/strategies/delete/route.ts', import.meta.url), 'utf8');

test('strategy lifecycle exposes edit duplicate archive restore and soft delete actions', () => {
  for (const action of ['Edit', 'Duplicate', 'Archive', 'Restore', 'Delete strategy']) {
    assert.match(builder, new RegExp(`w\\('${action.replace(/\s+/g, ' ')}'\\)`));
  }
  assert.match(builder, /isArchived/);
  assert.match(builder, /ARCHIVED/);
});

test('safe strategy deletion requires an explicit confirmation dialog and archive update', () => {
  assert.match(builder, /Delete strategy\?/);
  assert.match(builder, /role="dialog"/);
  assert.match(builder, /aria-modal="true"/);
  assert.match(builder, /deleteConfirmation!==['"]DELETE['"]/);
  assert.match(route, /z\.literal\(['"]DELETE['"]\)/);
  assert.match(route, /is_archived:\s*true/);
  assert.match(route, /is_default:\s*false/);
});

test('soft delete preserves historical references and does not hard-delete strategy rows', () => {
  assert.match(route, /from\('strategy_profiles'\)/);
  assert.match(route, /update\(\{\s*is_archived:\s*true/);
  assert.doesNotMatch(route, /delete from public\.strategy_profiles|delete from public\.strategy_profiles/);
  assert.doesNotMatch(route, /strategy_profile_id\s*=\s*null/);
});

test('default strategies cannot be soft-deleted, and archived strategies are excluded from active selection', () => {
  assert.match(builder, /disabled=\{selectedProfile\.isDefault\}/);
  assert.match(route, /is_default\s*:\s*false/);
  assert.match(route, /eq\('is_archived', false\)/);
});
