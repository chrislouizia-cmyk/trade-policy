import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import type {MarketplaceInstallResult,MarketplaceLicenseBoundary,MarketplaceListingSummary,MarketplaceReleasePreview} from '../lib/marketplace/contracts.ts';

const migration=readFileSync(new URL('../supabase/migrations/050_marketplace_foundation_phase_1a.sql',import.meta.url),'utf8');
const activeStrategy=readFileSync(new URL('../lib/server/active-strategy.ts',import.meta.url),'utf8');
const analyze=readFileSync(new URL('../app/api/market/analyze/route.ts',import.meta.url),'utf8');
const validate=readFileSync(new URL('../app/api/validate/route.ts',import.meta.url),'utf8');

test('marketplace release, review, and ranking records are immutable or append-only',()=>{
  assert.match(migration,/create table if not exists public\.marketplace_strategy_releases/);
  assert.match(migration,/before update on public\.marketplace_strategy_releases/);assert.match(migration,/before delete on public\.marketplace_strategy_releases/);
  assert.match(migration,/before update on public\.marketplace_release_rankings/);assert.match(migration,/before delete on public\.marketplace_review_events/);
});
test('fixed display-only pricing and simulated installs cannot charge commerce',()=>{
  for(const contract of ['display_price_cents = 3000','creator_share_cents = 1500','platform_share_cents = 1500','commerce_enabled = false','charged_cents = 0','SIMULATED_INTERNAL'])assert.match(migration,new RegExp(contract));
});
test('release snapshots and internal listing tables are inaccessible directly to customer roles',()=>{
  assert.match(migration,/enable row level security/);assert.match(migration,/revoke all on public\.marketplace_strategy_releases,public\.marketplace_listings,public\.marketplace_installs,public\.marketplace_release_rankings,public\.marketplace_review_events from public,anon,authenticated/);
  assert.match(migration,/marketplace installs select own/);assert.doesNotMatch(migration,/create policy .*releases.*for select to authenticated/i);
});
test('provenance is nullable and backward compatible across strategy, scan, decision, and trade records',()=>{
  for(const table of ['strategy_profiles','market_scans','decision_reports','active_trades'])assert.match(migration,new RegExp(`alter table public\\.${table} add column if not exists marketplace_`));
  assert.match(migration,/on delete set null/);
});
test('marketplace contracts make safe DTOs distinct from the server-only release snapshot',()=>{
  const summary:MarketplaceListingSummary={listingId:'l',releaseId:'r',strategyName:'Name',creatorName:null,category:null,instruments:[],timeframeRoles:{macro:null,execution:null},ruleCounts:{total:0,required:0,optional:0,automatic:0,manual:0,external:0},compatibility:'NEEDS_REVIEW',displayPriceCents:3000,creatorShareCents:1500,platformShareCents:1500,commerceEnabled:false};
  const preview:MarketplaceReleasePreview={releaseId:'r',releaseVersion:1,creatorName:null,listing:summary,reviewStatus:'DRAFT',usage:{installs:0,analyses:0,decisions:0,trades:0},scores:{performance:null,marketplaceReadiness:null,scoreVersion:null}};
  const install:MarketplaceInstallResult={installId:'i',releaseId:'r',installedStrategyId:'s',chargedCents:0,entitlementMode:'SIMULATED_INTERNAL',active:false,internalTest:true};
  const license:MarketplaceLicenseBoundary={licenseModel:'RENTAL',rights:'USE_INSIDE_TRADE_POLICE',transferable:false,resellable:false,sourceAccess:false,reverseEngineeringAllowed:false};
  assert.equal(preview.listing.commerceEnabled,false);assert.equal(install.active,false);assert.equal(license.sourceAccess,false);
  const snapshot=readFileSync(new URL('../lib/server/marketplace-release-snapshot.ts',import.meta.url),'utf8');assert.match(snapshot,/server-only/);
});
test('Phase 1A does not change active strategy or runtime authority',()=>{
  assert.doesNotMatch(activeStrategy,/marketplace_release_id/);assert.doesNotMatch(analyze,/marketplace_release_id/);assert.doesNotMatch(validate,/marketplace_release_id/);
});
