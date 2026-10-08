import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = read('supabase/migrations/20260916060023_strategy_sharing_v1.sql');
const ownerApi = read('app/api/strategies/share/route.ts');
const recipientApi = read('app/api/strategy-shares/[code]/route.ts');
const dialog = read('components/StrategyShareDialog.tsx');
const preview = read('components/SharedStrategyInstall.tsx');

test('strategy sharing stores a stable invitation with immutable version snapshots', () => {
  assert.match(migration, /create table public\.strategy_shares/i);
  assert.match(migration, /create table public\.strategy_share_versions/i);
  assert.match(migration, /unique \(share_id, version\)/i);
  assert.match(migration, /strategy_share_versions_immutable_update/i);
  assert.match(migration, /strategy_share_versions_immutable_delete/i);
  assert.match(migration, /marketplace_normalize_strategy_profile_for_revision\(p_strategy_id\)/i);
});

test('sharing tables are private by default and expose only participant reads', () => {
  for (const table of ['strategy_shares', 'strategy_share_versions', 'strategy_share_installs']) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
    assert.match(migration, new RegExp(`alter table public\\.${table} force row level security`, 'i'));
  }
  assert.match(migration, /revoke all on table public\.strategy_shares, public\.strategy_share_versions, public\.strategy_share_installs\s+from public, anon, authenticated/i);
  assert.doesNotMatch(migration, /grant (insert|update|delete).*strategy_share/i);
  assert.match(migration, /strategy shares select own/i);
  assert.match(migration, /strategy share installs select participant/i);
  assert.match(migration, /revoke all on function public\.marketplace_normalize_strategy_profile_for_revision\(uuid\)\s+from public, anon, authenticated/i);
});

test('install creates an inactive private copy and never changes active strategy', () => {
  assert.match(migration, /values\(v_user_id, v_name, false, false\)/i);
  assert.match(migration, /You already own this strategy/i);
  assert.match(migration, /installed_version < v_share\.current_version/i);
  assert.doesNotMatch(migration, /set_active_strategy|is_default\s*=\s*true/i);
  assert.match(migration, /get_effective_plan_code_for_user\(v_user_id\)/i);
});

test('routes authenticate before publish, preview, revoke, and install', () => {
  assert.match(ownerApi, /supabase\.auth\.getUser\(\)/);
  assert.match(ownerApi, /publish_strategy_share_v1/);
  assert.match(ownerApi, /revoke_strategy_share_v1/);
  assert.match(recipientApi, /supabase\.auth\.getUser\(\)/);
  assert.match(recipientApi, /resolve_strategy_share_v1/);
  assert.match(recipientApi, /install_strategy_share_v1/);
});

test('UI explains ownership, inactivity, versions, revocation, copying, and QR sharing', () => {
  assert.match(dialog, /QRCode\.toDataURL/);
  assert.match(dialog, /creator keeps ownership/i);
  assert.match(dialog, /never changed automatically/i);
  assert.match(dialog, /Revoke link/i);
  assert.match(preview, /Nothing activates automatically/i);
  assert.match(preview, /may not resell, republish, or claim/i);
  assert.match(preview, /Update my copy to v/);
});
