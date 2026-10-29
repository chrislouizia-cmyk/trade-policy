import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../supabase/migrations/20260918004003_marketplace_public_store_and_strategy_clock.sql', import.meta.url), 'utf8');
const catalog = readFileSync(new URL('../app/marketplace/page.tsx', import.meta.url), 'utf8');
const detail = readFileSync(new URL('../app/marketplace/[listingId]/page.tsx', import.meta.url), 'utf8');
const publicData = readFileSync(new URL('../lib/server/public-marketplace.ts', import.meta.url), 'utf8');
const installRoute = readFileSync(new URL('../app/api/marketplace/[listingId]/route.ts', import.meta.url), 'utf8');

test('observation clock is strategy-wide, backfilled, and starts on the first real trade', () => {
  assert.match(migration, /marketplace_strategy_observation_clocks/);
  assert.match(migration, /select strategy_profile_id, user_id, min\(opened_at\), max\(opened_at\)/i);
  assert.match(migration, /where strategy_profile_id is not null and opened_at is not null/i);
  assert.match(migration, /update public\.marketplace_strategy_candidates candidate set/);
  assert.match(migration, /update public\.marketplace_release_verified_metrics metric set/);
  assert.match(migration, /where source_strategy_id=p_source_strategy_id/);
  const evaluator = migration.slice(migration.indexOf('create or replace function public.evaluate_marketplace_strategy_candidate'));
  const clockSection = evaluator.slice(0, evaluator.indexOf("select count(*)::integer into v_backtests"));
  assert.doesNotMatch(clockSection, /strategy_revision_id=p_source_strategy_revision_id/);
  assert.match(evaluator, /greatest\(1,1\+floor\(extract\(epoch from\(now\(\)-v_first_trade_at\)\)\/86400\)\)/);
});

test('public catalog exposes sanitized metadata and metrics, never the licensed snapshot', () => {
  assert.match(publicData, /sanitized_metadata/);
  assert.match(publicData, /marketplace_release_verified_metrics/);
  assert.doesNotMatch(publicData, /snapshot_json|licensedStrategy/);
  assert.match(catalog, /Strategy Marketplace/);
  assert.match(detail, /MarketplaceInstallButton/);
});

test('public install is authenticated, server-authorized, free, inactive, and idempotent', () => {
  assert.match(installRoute, /supabase\.auth\.getUser\(\)/);
  assert.match(installRoute, /install_public_marketplace_strategy/);
  assert.match(migration, /security definer/);
  assert.match(migration, /visibility='PUBLIC' and review_status='APPROVED'/);
  assert.match(migration, /'FREE_PUBLIC',0,'INSTALLED'/);
  assert.match(migration, /'active',false,'alreadyInstalled',true/);
  assert.match(migration, /is_default[\s\S]*false/);
  assert.match(migration, /revoke all on function public\.install_public_marketplace_strategy\(uuid\) from public,anon/);
});

test('delete archives discovery but preserves immutable releases and historical evidence', () => {
  assert.match(migration, /disable trigger marketplace_release_immutable_update[\s\S]*update public\.marketplace_strategy_releases set source_strategy_origin_id=source_strategy_id[\s\S]*enable trigger marketplace_release_immutable_update/);
  assert.match(migration, /on delete set null/);
  assert.match(migration, /source_strategy_origin_id/);
  assert.match(migration, /SOURCE_STRATEGY_DELETED/);
  assert.match(migration, /review_status='ARCHIVED'/);
  assert.doesNotMatch(migration, /delete from public\.(active_trades|trade_records|decision_reports|marketplace_strategy_releases)/);
  assert.match(migration, /update public\.active_trades set strategy_profile_id=null/);
  assert.match(migration, /preservedMarketplaceReleases/);
  assert.match(migration, /where id=p_strategy_id and user_id=uid/);
});
