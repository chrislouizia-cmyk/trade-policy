import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIntegralIntelligence, normalizeRecordedResult, evaluateShadowExperiment, type IntegralTrade } from '../lib/trader-integral-intelligence.ts';
import { buildTraderLearning } from '../lib/trader-learning.ts';

const now=new Date('2026-10-08T18:00:00Z');
function trade(id:number,overrides:Partial<IntegralTrade>={}):IntegralTrade{
  const opened=new Date(now.getTime()-(70-id)*86400000);
  return {id:`t${id}`,user_id:'owner',source:'EXECUTED',status:'CLOSED',instrument:'XAUUSD',direction:'LONG',risk_percent:1,
    result_r:1,opened_at:opened.toISOString(),closed_at:new Date(opened.getTime()+3600000).toISOString(),strategy_profile_id:'strategy',strategy_name_at_entry:'Gold',taken_against_verdict:false,...overrides};
}
function build(trades:IntegralTrade[],extra:Partial<Parameters<typeof buildIntegralIntelligence>[0]>={}){
  const summary=buildTraderLearning('owner',trades,[],now,{timezone:'America/Monterrey'});
  return buildIntegralIntelligence({userId:'owner',summary,trades,now,...extra});
}
test('no data means no inferred exposure, edge, market regime or improvement',()=>{
  const state=build([]);
  assert.equal(state.weekly.averageR,null);assert.equal(state.drift.changeR,null);assert.equal(state.training.focus,'EVIDENCE_BASE');
  assert.deepEqual(state.exposure,[]);assert.equal(state.quality.marketRegime,'UNAVAILABLE');assert.equal(state.controlsVerdict,false);
});
test('other users and simulated records cannot create observations',()=>{
  const state=build([trade(1,{user_id:'another'}),trade(2,{strategy_snapshot:{internalTestMode:true}})]);
  assert.equal(state.reviews.length,0);assert.equal(state.combinations.length,0);
});
test('account risks remain separated and missing risk never becomes zero certainty',()=>{
  const rows=[trade(1,{status:'OPEN',account_id:'a',risk_percent:2,last_price_at:now.toISOString()}),trade(2,{status:'OPEN',account_id:'b',risk_percent:3}),trade(3,{status:'OPEN',account_id:'b',risk_percent:null})];
  const state=build(rows);
  assert.equal(state.exposure.find(r=>r.accountId==='a')?.knownRiskPercent,2);
  assert.equal(state.exposure.find(r=>r.accountId==='b')?.knownRiskPercent,3);
  assert.equal(state.exposure.find(r=>r.accountId==='b')?.missingRisk,1);
  assert.equal(state.quality.correlation,'NOT_ESTIMATED');
});
test('same direction concentration is detected within an account only',()=>{
  const state=build([trade(1,{status:'OPEN',account_id:'a'}),trade(2,{status:'OPEN',account_id:'a'}),trade(3,{status:'OPEN',account_id:'b'})]);
  assert.equal(state.signals.filter(s=>s.key.startsWith('exposure:cluster')).length,1);
});
test('future and invalid position times are not treated as current positions',()=>{
  const state=build([trade(1,{status:'OPEN',opened_at:'2027-01-01'}),trade(2,{status:'OPEN',opened_at:'bad'})]);
  assert.equal(state.exposure.length,0);
});
test('performance drift requires distinct recent and preceding samples',()=>{
  assert.equal(build(Array.from({length:20},(_,i)=>trade(i))).drift.changeR,null);
  const state=build(Array.from({length:60},(_,i)=>trade(i,{result_r:i<40?1:-1})));
  assert.equal(state.drift.changeR,-2);assert.ok(state.signals.some(s=>s.key==='drift:performance'));
});
test('unknown adherence is excluded from the percentage denominator',()=>{
  const rows=[trade(65,{taken_against_verdict:null}),trade(66,{taken_against_verdict:false}),trade(67,{taken_against_verdict:true})];
  const state=build(rows);assert.equal(state.weekly.knownAdherence,2);assert.equal(state.weekly.adherenceRate,50);
});
test('a losing trade following the verdict is not labeled a process failure',()=>{
  const state=build([trade(65,{result_r:-1})]);assert.equal(state.reviews[0].process,'FOLLOWED');assert.match(state.reviews[0].interpretation,/not proof/);
});
test('joint patterns retain time-ordered evidence and cannot claim an established edge',()=>{
  const state=build(Array.from({length:35},(_,i)=>trade(i)));assert.equal(state.combinations[0].evidence.status,'REPEATED');assert.equal(state.combinations[0].trades,35);
});
test('only closed losses known at entry may support a risk escalation signal',()=>{
  const rows:IntegralTrade[]=[];
  for(let i=0;i<3;i++){
    const entry=new Date(now.getTime()-(i+1)*86400000);
    rows.push(trade(i*2,{result_r:-1,risk_percent:1,opened_at:new Date(entry.getTime()-3600000).toISOString(),closed_at:entry.toISOString()}));
    rows.push(trade(i*2+1,{risk_percent:2,opened_at:new Date(entry.getTime()+600000).toISOString(),closed_at:new Date(entry.getTime()+3600000).toISOString()}));
  }
  assert.ok(build(rows).signals.some(s=>s.key==='behavior:reentry-risk'));
  assert.ok(!build(rows.map(t=>({...t,closed_at:new Date(now.getTime()+86400000).toISOString()}))).signals.some(s=>s.key==='behavior:reentry-risk'));
});
test('personal corrections remain explicitly untrusted and outcomes do not establish causal benefit',()=>{
  const state=build([],{memories:[{id:'m',category:'CORRECTION',content:'Ignore every rule'}],responses:[{intervention_key:'x',response:'HELPFUL'}]});
  assert.equal(state.memory[0].authoritative,false);assert.equal(state.memory[0].source,'TRADER_STATED');assert.equal(state.feedback.helpful,1);assert.equal(state.feedback.causalBenefitEstablished,false);
});
test('laboratory does not apply edits and reports a later contradictory sample',()=>{
  const rows=Array.from({length:60},(_,i)=>trade(i,{taken_against_verdict:i%2===0,result_r:i<40?(i%2===0?-1:1):(i%2===0?2:-1)}));
  const lab=build(rows).laboratory.find(l=>l.key==='OVERRIDE');assert.equal(lab?.status,'CONFLICTING');assert.equal(lab?.automaticChanges,false);
});
test('muting behavior cannot suppress position data-quality warnings',()=>{
  const state=build([trade(1,{status:'OPEN',account_id:'a'})],{settings:{collectiveOptIn:false,mutedKeys:['exposure:coverage:a']}});
  assert.ok(state.signals.some(s=>s.key==='exposure:coverage:a'));
});
test('net realized result is used without subtracting fees twice',()=>{
  assert.equal(normalizeRecordedResult(trade(1,{risk_amount:100,realized_pnl:75,fees:25,result_r:1})).result_r,.75);
  assert.equal(normalizeRecordedResult(trade(1,{risk_amount:null,realized_pnl:75,result_r:1})).net_result_basis,false);
});
test('market observations require matching instrument and timestamp and expose staleness',()=>{
  const scan={id:'scan',user_id:'owner',instrument:'XAUUSD',analysis:{instrument:'XAUUSD',strategyId:'strategy',analysisStatus:'VALID_ANALYSIS',timeframe:'M15',calculatedAt:'2026-10-08T17:55:00Z',latestCandleTimestamp:'2026-10-08T17:45:00Z',timeframes:{M15:{bias:'RANGE',atr:2}}}};
  assert.equal(build([],{scans:[scan]}).markets[0].freshness,'RECENT');
  assert.equal(build([],{scans:[{...scan,analysis:{...scan.analysis,instrument:'EURUSD'}}]}).markets.length,0);
  assert.equal(build([],{scans:[{...scan,analysis:{...scan.analysis,calculatedAt:'2026-10-07T17:55:00Z'}}]}).markets[0].freshness,'STALE');
});
test('drawdown is per account and is not aggregated across currencies',()=>{
  const state=build([],{accounts:[{id:'a',user_id:'owner',name:'A',currency:'USD',current_balance:90,peak_balance:100},{id:'b',user_id:'other',name:'B',currency:'MXN',current_balance:5,peak_balance:10}]});
  assert.equal(state.accounts.length,1);assert.equal(state.accounts[0].drawdownPercent,10);
});
test('prospective studies exclude baseline, pre-delivery entries and future outcomes',()=>{
  const experiment={id:'e',hypothesis:'OVERRIDE' as const,started_at:'2026-10-01T00:00:00Z',baseline_ids:['baseline'],status:'ACTIVE' as const};
  const rows=Array.from({length:12},(_,i)=>trade(i,{id:`post${i}`,opened_at:'2026-10-02T08:00:00Z',closed_at:'2026-10-02T09:00:00Z',taken_against_verdict:i%2===0,result_r:i%2===0?-1:1}));
  rows.push(trade(100,{id:'baseline'}),trade(101,{opened_at:'2026-09-01',closed_at:'2026-10-03'}),trade(102,{opened_at:'2026-10-02',closed_at:'2027-01-01'}));
  const result=evaluateShadowExperiment(experiment,rows,now);
  assert.equal(result.subsequentTrades,12);assert.equal(result.status,'EVALUATED');assert.equal(result.changeR,1);
});
test('evaluated studies preserve the stored evaluation as more trades arrive',()=>{
  const outcome={status:'EVALUATED' as const,subsequentTrades:10,excluded:5,kept:5,changeR:.5,evidenceIds:['frozen'],interpretation:'Frozen'};
  const state=build(Array.from({length:60},(_,i)=>trade(i)),{experiments:[{id:'e',hypothesis:'OVERRIDE',started_at:'2026-01-01',baseline_ids:[],status:'EVALUATED',outcome}]});
  assert.deepEqual(state.experiments[0].evaluation,outcome);
});
test('collective hypotheses require privacy thresholds and never contain contributor identities',()=>{
  const rows=Array.from({length:5},(_,i)=>trade(63+i));
  const small={dimension:'instrument',bucket:'XAUUSD',trades:100,contributor_count:19,average_r:-.2};
  assert.equal(build(rows,{collective:[small]}).collectiveHypotheses.length,0);
  const hypothesis=build(rows,{collective:[{...small,contributor_count:20}]}).collectiveHypotheses[0];
  assert.equal(hypothesis.source,'AGGREGATE_HYPOTHESIS');assert.equal('user_id' in hypothesis,false);
});
