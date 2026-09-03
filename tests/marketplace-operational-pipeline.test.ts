import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const read=(file:string)=>readFileSync(new URL(`../${file}`,import.meta.url),'utf8');
const migration=read('supabase/migrations/094_marketplace_observation_and_install_pipeline.sql');
const revisionAlignment=read('supabase/migrations/095_align_internal_marketplace_revision_validation.sql');

test('qualification policy is explicit versioned and private by default',()=>{
  for(const contract of ["'MARKETPLACE_QUALIFICATION_V1',180,100,90,0,12,true",'marketplace_strategy_candidates','enable row level security','OWNER_CONSENT_PENDING','UNDER_REVIEW'])assert.match(migration,new RegExp(contract));
  assert.match(migration,/revoke all on public\.marketplace_qualification_policies,public\.marketplace_strategy_candidates from public,anon,authenticated/);
});

test('qualification uses exact revision evidence and cannot publish without consent',()=>{
  assert.match(migration,/strategy_revision_id=p_source_strategy_revision_id/g);
  assert.match(migration,/owner_consent_status='GRANTED'/);
  assert.match(migration,/c\.owner_user_id<>auth\.uid\(\)/);
  assert.match(migration,/Strategy has not reached the qualification threshold/);
});

test('licensed installs use the immutable protected snapshot and remain inactive',()=>{
  assert.match(migration,/licensedStrategy/);
  assert.match(migration,/s:=r\.snapshot_json->'licensedStrategy'/);
  assert.match(migration,/SIMULATED_INTERNAL/);
  assert.match(migration,/'active',false/);
  assert.doesNotMatch(migration,/select new_strategy,p_recipient_user_id,x\.symbol/);
});

test('Marketplace UI synchronizes every strategy and links cards by listing identity',()=>{
  const lab=read('components/hq/MarketplaceLab.tsx');
  assert.match(lab,/Evaluate all strategies/);assert.match(lab,/PRIVATE OBSERVATION/);assert.match(lab,/item\.listing\.listingId/);
  assert.doesNotMatch(lab,/href=\{`\/hq\/marketplace\/\$\{item\.releaseId\}`\}/);
  const sync=read('app/api/hq/marketplace/sync/route.ts');assert.match(sync,/syncMarketplaceCandidates/);assert.match(sync,/is_owner/);
});

test('release review and installation are usable from a sanitized detail screen',()=>{
  const api=read('app/api/hq/marketplace/[listingId]/route.ts');const detail=read('components/hq/MarketplaceReleaseDetail.tsx');
  assert.doesNotMatch(api,/snapshot_json/);assert.match(api,/allowedTransitions/);assert.match(api,/refresh_marketplace_release_verified_metrics/);
  assert.match(api,/staff_marketplace_transition_listing/);assert.match(migration,/callers cannot leave a half-reviewed listing/);
  assert.match(detail,/Install internal test license/);assert.match(detail,/COMPLIANCE GATE/);assert.match(detail,/APPEND-ONLY AUDIT/);
});

test('strategy owner gets an explicit consent gate after qualification',()=>{
  const card=read('components/MarketplaceObservationCard.tsx');const api=read('app/api/strategies/[id]/marketplace/route.ts');
  assert.match(card,/Nothing becomes public without your permission/);assert.match(card,/Authorize internal review/);
  assert.match(card,/marketplace-consent-check/);assert.match(card,/MARKETPLACE · PRIVADO/);assert.match(card,/MARKETPLACE · PRIVÉ/);
  assert.match(api,/set_marketplace_strategy_owner_consent/);assert.match(api,/MARKETPLACE_OWNER_TERMS_V1/);
  assert.match(migration,/'CUSTOMER_BETA'/);assert.match(migration,/'INTERNAL','IN_REVIEW'/);assert.match(migration,/OWNER_CONSENT_SUBMITTED/);
  assert.match(migration,/Public visibility and commerce remain disabled/);
});

test('catalog usage is derived from actual installs and exact-revision evidence',()=>{
  const catalog=read('app/api/hq/marketplace/route.ts');
  assert.match(catalog,/installsByRelease/);assert.match(catalog,/candidateByRevision/);
  assert.match(catalog,/decision_count:candidate\?\.savedDecisions/);assert.match(catalog,/trade_count:candidate\?\.closedTrades/);
});

test('internal test modal keeps its publish controls visible on short viewports',()=>{
  const css=read('app/trade-police.css');const lab=read('components/hq/MarketplaceLab.tsx');
  assert.match(lab,/createPortal/);assert.match(lab,/document\.body/);
  assert.match(css,/\.marketplace-create-modal\{max-height:min\(calc\(100dvh - 24px\),760px\);grid-template-rows:auto auto minmax\(0,1fr\) auto;gap:14px;overflow:hidden\}/);
  assert.match(css,/\.marketplace-create-form\{min-height:0;overflow-y:auto;overscroll-behavior:contain/);
  assert.match(css,/\.marketplace-create-footer\{position:relative;z-index:1/);
});

test('qualification cards explain thresholds and can open internal testing',()=>{
  const lab=read('components/hq/MarketplaceLab.tsx');
  assert.match(lab,/View qualification details/);
  assert.match(lab,/Public qualification is not ready yet/);
  assert.match(lab,/Create internal test listing/);
  assert.match(lab,/openInternalTestForCandidate\(candidate\.strategyId\)/);
  const api=read('app/api/hq/marketplace/route.ts');
  assert.match(api,/databaseCode: creationError\.code/);
});

test('internal releases tolerate serialization differences without trusting browser strategy data',()=>{
  assert.match(revisionAlignment,/v_normalized_strategy ->> ''id'' is distinct from v_current_strategy ->> ''id''/i);
  assert.match(revisionAlignment,/regexp_replace\(/);
  assert.match(revisionAlignment,/function_definition ~\* current_guard_pattern/i);
  assert.match(revisionAlignment,/raise exception 'Expected Marketplace revision guard was not found'/);
  assert.match(revisionAlignment,/create_internal_marketplace_release_v1\(uuid,text,text\)/);
  assert.match(revisionAlignment,/grant execute .* to authenticated/);
  const source=read('supabase/migrations/065_marketplace_revision_single_canonical_source.sql');
  assert.match(source,/v_snapshot := jsonb_build_object/);
  assert.match(source,/v_source_profile\.id/);
  assert.match(source,/v_expected_source_revision_id <> p_source_strategy_revision_id/);
});

test('095 detects the lowercase pg_get_functiondef guard and remains idempotent',()=>{
  const lowerCaseDefinition = "if v_normalized_strategy <> v_current_strategy then\n  raise exception 'guard';\nend if;";
  const upperCaseDefinition = "IF v_normalized_strategy <> v_current_strategy THEN\n  raise exception 'guard';\nEND IF;";
  const alreadyCorrect = "if v_normalized_strategy ->> 'id' is distinct from v_current_strategy ->> 'id' then\n  raise exception 'guard';\nend if;";
  const unknownGuard = "if v_other_strategy <> v_current_strategy then\n  raise exception 'guard';\nend if;";

  assert.match(lowerCaseDefinition, /if\s+v_normalized_strategy\s*<>\s*v_current_strategy\s*then/i);
  assert.match(upperCaseDefinition, /if\s+v_normalized_strategy\s*<>\s*v_current_strategy\s*then/i);
  assert.match(alreadyCorrect, /if\s+v_normalized_strategy\s*->>\s*'id'\s+is\s+distinct\s+from\s+v_current_strategy\s*->>\s*'id'\s+then/i);
  assert.doesNotMatch(unknownGuard, /if\s+v_normalized_strategy\s*<>\s*v_current_strategy\s*then/i);
  assert.match(revisionAlignment, /function_definition ~\* current_guard_pattern/i);
  assert.match(revisionAlignment, /function_definition ~\* target_guard_pattern/i);
});
