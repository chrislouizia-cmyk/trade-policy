import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("personal intelligence is downstream of and cannot control deterministic authorization", () => {
  const route = read("app/api/validate/route.ts");
  const engine = route.indexOf("validateTradeWithStrategy(input");
  const eligibility = route.indexOf("evaluateTradeAuthorizationEligibility({");
  const intelligence = route.indexOf("buildTraderInterventions(await learningSnapshotPromise");
  assert.ok(engine > 0);
  assert.ok(eligibility > engine);
  assert.ok(intelligence > eligibility);
  assert.match(route, /controlsVerdict:false/);
  assert.doesNotMatch(route, /validateTradeWithStrategy\([^)]*personalIntelligence/);
});

test("active-trade intelligence remains separate from deterministic guidance", () => {
  const route = read("app/api/trades/reanalyze/route.ts");
  assert.ok(route.indexOf("let status:GuidanceStatus") < route.indexOf("buildTraderInterventions(await learningSnapshotPromise"));
  assert.match(route, /personalIntelligence:\{authoritative:false,controlsVerdict:false/);
  assert.match(read("components/ActiveTradeMonitor.tsx"), /PersonalIntelligenceNotice intelligence=\{trade\.last_analysis\?\.personalIntelligence\}/);
});

test("collective tables are server-only and strategy-free", () => {
  const migration = read("supabase/migrations/20261007145556_trader_intelligence_interventions.sql");
  assert.match(migration, /dimension in \('hour','weekday','instrument','session','discipline'\)/);
  assert.doesNotMatch(migration, /dimension in \([^)]*'strategy'/);
  assert.match(migration, /contributor_count >= 20/);
  assert.match(migration, /trades >= 100/);
  assert.match(migration, /revoke all on public\.trader_intelligence_recommendations[^;]+authenticated/);
  assert.match(migration, /grant select on public\.trader_intelligence_recommendations,public\.trader_intelligence_interventions to authenticated/);
  assert.doesNotMatch(migration, /grant select on public\.trader_intelligence_contributions to authenticated/);
});

test("the visible layer stays compact and disappears without meaningful evidence", () => {
  const component = read("components/PersonalIntelligenceNotice.tsx");
  assert.match(component, /if \(!interventions\.length\) return null/);
  assert.match(component, /Context only · your strategy and deterministic rules still control the verdict/);
  assert.match(component, /<details>/);
});
