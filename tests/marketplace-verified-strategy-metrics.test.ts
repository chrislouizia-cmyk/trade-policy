import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../supabase/migrations/057_marketplace_verified_strategy_metrics.sql', import.meta.url),
  'utf8'
);

test('marketplace verified metrics are keyed by exact release and revision, not profile alone', () => {
  assert.match(migration, /create table if not exists public\.marketplace_release_verified_metrics/i);
  assert.match(migration, /source_strategy_id uuid not null/i);
  assert.match(migration, /source_strategy_revision_id text not null/i);
  assert.match(migration, /marketplace_release_id uuid not null references public\.marketplace_strategy_releases\(id\)/i);
  assert.match(migration, /unique\(source_strategy_id, source_strategy_revision_id, marketplace_release_id\)/i);
  assert.match(migration, /never aggregate by strategy profile alone|strategy profile alone/i);
  assert.match(migration, /p_marketplace_release_id\s+uuid[\s\S]*?p_source_strategy_id\s+uuid[\s\S]*?p_source_strategy_revision_id\s+text/i);
  assert.match(migration, /create or replace function public\.refresh_marketplace_release_verified_metrics/i);
});

test('release identity is enforced before any aggregation and null or mismatched attribution is excluded', () => {
  assert.match(migration, /v_release\.source_strategy_id\s*(?:<>|=)\s*p_source_strategy_id/i);
  assert.match(migration, /v_release\.source_strategy_revision_id\s*(?:<>|=)\s*p_source_strategy_revision_id/i);
  assert.match(migration, /raise exception 'Release strategy revision mismatch'/i);
  assert.match(migration, /at\.strategy_profile_id\s*=\s*p_source_strategy_id/i);
  assert.match(migration, /coalesce\(at\.strategy_revision_id, ''\)\s*=\s*p_source_strategy_revision_id/i);
  assert.match(migration, /dr\.strategy_id\s*=\s*p_source_strategy_id/i);
  assert.match(migration, /dr\.marketplace_release_id\s*=\s*p_marketplace_release_id/i);
  assert.match(migration, /dr\.strategy_revision_id\s+is not null/i);
  assert.match(migration, /coalesce\(dr\.strategy_revision_id, ''\)\s*=\s*p_source_strategy_revision_id/i);
});

test('closed trades are the only source for outcome performance metrics', () => {
  assert.match(migration, /at\.status\s*=\s*'CLOSED'/i);
  assert.match(migration, /at\.closed_at\s+is not null/i);
  assert.match(migration, /status\s*=\s*'CLOSED'/i);
  assert.match(migration, /closed_at\s+is not null/i);
});

test('observation timestamps are exact and remain null when evidence is absent', () => {
  assert.match(migration, /observation_started_at timestamptz/i);
  assert.match(migration, /last_verified_activity_at timestamptz/i);
  assert.match(migration, /observation_days integer default null/i);
  assert.match(migration, /market_scans[\s\S]*?created_at/i);
  assert.match(migration, /decision_reports[\s\S]*?created_at/i);
  assert.match(migration, /active_trades[\s\S]*?created_at/i);
  assert.match(migration, /NOT_ENOUGH_VERIFIED_DATA/i);
  assert.match(migration, /when\s+v_has_verified_activity\s+then\s+'VERIFIED'/i);
});

test('unsupported metrics remain null and not fabricated', () => {
  assert.match(migration, /metric_status text not null default 'NOT_ENOUGH_VERIFIED_DATA'/i);
  assert.match(migration, /max_drawdown_r numeric default null/i);
  assert.match(migration, /strategy_adherence_rate numeric default null/i);
  assert.match(migration, /rule_violation_count integer default null/i);
  assert.match(migration, /outside_session_count integer default null/i);
  assert.match(migration, /risk_violation_count integer default null/i);
  assert.match(migration, /NOT_ENOUGH_VERIFIED_DATA/i);
  assert.doesNotMatch(migration, /max_drawdown_r.*0|strategy_adherence_rate.*0|outside_session_count.*0|risk_violation_count.*0|rule_violation_count.*0/i);
});

test('creator lifetime metrics are kept separate from this exact release revision metrics', () => {
  assert.match(migration, /creator_user_id uuid not null/i);
  assert.match(migration, /creator_display_name text/i);
  assert.match(migration, /member_since timestamptz/i);
  assert.match(migration, /total_verified_platform_trades integer default null/i);
  assert.match(migration, /total_marketplace_strategies integer default null/i);
  assert.match(migration, /not from public\.profiles\s+where.*creator_user_id/i);
});

test('formula implementation covers only currently available and derivable metrics', () => {
  assert.match(migration, /wins integer default null/i);
  assert.match(migration, /losses integer default null/i);
  assert.match(migration, /break_even integer default null/i);
  assert.match(migration, /win_rate numeric default null/i);
  assert.match(migration, /loss_rate numeric default null/i);
  assert.match(migration, /total_r numeric default null/i);
  assert.match(migration, /average_r numeric default null/i);
  assert.match(migration, /expectancy_r numeric default null/i);
  assert.match(migration, /profit_factor numeric default null/i);
  assert.match(migration, /best_trade_r numeric default null/i);
  assert.match(migration, /worst_trade_r numeric default null/i);
  assert.match(migration, /max_win_streak integer default null/i);
  assert.match(migration, /max_loss_streak integer default null/i);
  assert.match(migration, /approved_trade_count integer default null/i);
  assert.match(migration, /rejected_or_no_trade_count integer default null/i);
});
