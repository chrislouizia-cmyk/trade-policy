import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration=readFileSync(new URL('../supabase/migrations/032_contextual_beta_feedback.sql',import.meta.url),'utf8');
const feedback=readFileSync(new URL('../components/ContextualAnalysisFeedback.tsx',import.meta.url),'utf8');
const validator=readFileSync(new URL('../components/TradeValidator.tsx',import.meta.url),'utf8');
const route=readFileSync(new URL('../app/api/beta-intelligence/feedback/route.ts',import.meta.url),'utf8');
const analysisRoute=readFileSync(new URL('../app/api/market/analyze/route.ts',import.meta.url),'utf8');
const saveRoute=readFileSync(new URL('../app/api/strategies/save/route.ts',import.meta.url),'utf8');
const dashboard=readFileSync(new URL('../app/hq/system/beta-intelligence/page.tsx',import.meta.url),'utf8');
const packageJson=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));

test('feedback is offered after five completed analyses and can be dismissed',()=>{
  assert.match(migration,/event_type='ANALYSIS_COMPLETED'/);
  assert.match(migration,/v_count>=5 and not v_exists/);
  assert.match(feedback,/Did this analysis reflect the way you actually trade\?/);
  for(const label of ['Exactly','Mostly','Not really','Dismiss feedback','Not now'])assert.match(feedback,new RegExp(label));
});

test('negative feedback collects an allowlisted category and optional comment',()=>{
  for(const label of ['Missing confirmation','Wrong interpretation','Missing indicator','Risk management','Timing','Other'])assert.match(feedback,new RegExp(label));
  assert.match(feedback,/Optional comments/);
  assert.match(route,/\.strict\(\)/);
  assert.match(route,/MISSING_CONFIRMATION/);
  assert.match(route,/Feedback category required/);
});

test('feedback storage is linked and server-versioned without trade data',()=>{
  for(const field of ['analysis_id','playbook_id','app_version'])assert.match(migration,new RegExp(field));
  assert.equal(route.match(/1\.0\.0-beta\.21/)?.[0],packageJson.version);
  assert.match(migration,/market_scans where id=p_analysis_id and user_id=v_user_id/);
  assert.match(analysisRoute,/analysisId:scan\.id/);
  assert.doesNotMatch(route,/market|instrument|entry|price|personalNote/i);
});

test('feedback never interrupts an active trade',()=>{
  assert.match(validator,/feedbackAnalysisId&&!hasActiveTrade&&<ContextualAnalysisFeedback/);
  assert.match(validator,/setFeedbackAnalysisId\(null\)/);
});

test('dashboard exposes all contextual feedback rankings',()=>{
  for(const label of ['Top missing confirmations','Most edited playbook rules','Most rejected simulations','Most common feedback categories'])assert.match(dashboard,new RegExp(label));
  assert.match(dashboard,/staff_contextual_feedback_metrics/);
  assert.match(saveRoute,/record_playbook_rule_edits/);
  assert.match(migration,/SIMULATION_REJECTED/);
});
