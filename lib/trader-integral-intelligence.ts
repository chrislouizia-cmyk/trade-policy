import type { LearningSummary, LearningTrade } from './trader-learning.ts';
import { assessPatternEvidence, type PatternEvidence } from './trader-pattern-evidence.ts';
import { isTradeLifecycleSimulationRecord } from './trade-lifecycle-v2-core.ts';

export type IntegralTrade = LearningTrade & {
  account_id?: string | null; risk_amount?: number | string | null;
  realized_pnl?: number | string | null; fees?: number | string | null;
  current_r?: number | string | null; last_price_at?: string | null;
  last_analyzed_at?: string | null; mfe_r?: number | string | null;
  last_analysis?: Record<string, unknown> | null;
  net_result_basis?: boolean;
};
export type IntegralSignal = {
  key: string; category: 'QUALITY' | 'EXPOSURE' | 'BEHAVIOR' | 'DRIFT' | 'REVIEW';
  severity: 'INFO' | 'CAUTION' | 'PAUSE'; title: string; detail: string;
  evidenceIds: string[]; sampleSize: number;
};
export type IntegralSettings = { collectiveOptIn: boolean; mutedKeys: string[] };
export type RecordedMarketObservation = { scanId:string; instrument:string; strategyId:string|null; timeframe:string; bias:'BULLISH'|'BEARISH'|'RANGE'; atr:number; calculatedAt:string; latestCandleAt:string; freshness:'RECENT'|'STALE' };
export type ShadowExperiment = {id:string;hypothesis:'OVERRIDE'|'LATE_SESSION';started_at:string;timezone?:string;baseline_ids:string[];status:'ACTIVE'|'EVALUATED';outcome?:unknown};
export function evaluateShadowExperiment(experiment:ShadowExperiment,trades:IntegralTrade[],at=new Date()) {
  const baseline=new Set(experiment.baseline_ids),start=Date.parse(experiment.started_at);
  const later=[...new Map(trades.map(t=>[t.id,t])).values()].filter(t=>!baseline.has(t.id)&&time(t.opened_at)>start&&time(t.closed_at)>=time(t.opened_at)&&time(t.closed_at)<=at.getTime()&&finite(t.result_r)!==null);
  const firstByDay=new Map<string,number>();
  for(const t of trades)if(Number.isFinite(time(t.opened_at))){const day=dateKey(t.opened_at!,experiment.timezone??'UTC');firstByDay.set(day,Math.min(firstByDay.get(day)??Infinity,time(t.opened_at)));}
  const excluded=later.filter(t=>experiment.hypothesis==='OVERRIDE'?t.taken_against_verdict===true:time(t.opened_at)-(firstByDay.get(dateKey(t.opened_at!,experiment.timezone??'UTC'))??time(t.opened_at))>=4*3600000);
  const excludedIds=new Set(excluded.map(t=>t.id)),kept=later.filter(t=>!excludedIds.has(t.id));
  const eligible=experiment.hypothesis==='OVERRIDE'?later.filter(t=>typeof t.taken_against_verdict==='boolean'):later;
  const knownKept=kept.filter(t=>eligible.some(e=>e.id===t.id));
  const ready=excluded.length>=5&&knownKept.length>=5;
  return {status:ready?'EVALUATED' as const:'ACTIVE' as const,subsequentTrades:eligible.length,excluded:excluded.length,kept:knownKept.length,
    changeR:ready?round(mean(knownKept)!-mean(eligible)!):null,evidenceIds:eligible.map(t=>t.id),
    interpretation:'Prospective observational shadow comparison. Selection was fixed at start; no orders or strategy rules were changed. Differences do not prove a causal benefit.'};
}
export type IntegralState = {
  brief?: { day: string; generatedAt: string; message: string; question: string; evidenceIds: string[]; source: 'OPENAI' | 'DETERMINISTIC'; failureCode: string | null };
  version: '1'; generatedAt: string; source: 'RECORDED'; controlsVerdict: false;
  signals: IntegralSignal[];
  markets: RecordedMarketObservation[];
  accounts:Array<{id:string;name:string;currency:string;balance:number|null;drawdownPercent:number|null}>;
  resultBasis:{netRecorded:number;feeImpactUnknown:number};
  collectiveHypotheses:Array<{dimension:string;bucket:string;trades:number;contributors:number;averageR:number;source:'AGGREGATE_HYPOTHESIS'}>;
  experiments:Array<ShadowExperiment & {evaluation:ReturnType<typeof evaluateShadowExperiment>}>;
  exposure: Array<{ accountId: string | null; positions: number; knownRiskPercent: number; missingRisk: number; staleQuotes: number; evidenceIds: string[] }>;
  combinations: Array<{ key: string; label: string; trades: number; averageR: number; evidenceIds: string[]; evidence: PatternEvidence }>;
  drift: { baselineTrades: number; recentTrades: number; baselineR: number | null; recentR: number | null; changeR: number | null };
  reviews: Array<{ tradeId: string; process: 'FOLLOWED' | 'OVERRIDDEN' | 'UNKNOWN'; resultR: number; interpretation: string }>;
  weekly: { trades: number; averageR: number | null; adherenceRate: number | null; knownAdherence: number; evidenceIds: string[] };
  training: { focus: string; action: string; evidenceIds: string[]; progress: { current: number | null; previous: number | null; sampleSize: number } };
  laboratory: Array<{ key: string; hypothesis: string; status: 'INSUFFICIENT' | 'SUPPORTED' | 'CONFLICTING'; discoveryExcluded: number; validationExcluded: number; discoveryChangeR: number | null; validationChangeR: number | null; evidenceIds: string[]; automaticChanges: false }>;
  feedback: { responses: number; helpful: number; notHelpful: number; causalBenefitEstablished: false };
  memory: Array<{ id: string; category: string; content: string; source: 'TRADER_STATED'; authoritative: false }>;
  quality: { historyLimit: number; potentiallyTruncated: boolean; brokerVerified: false; marketRegime: 'UNAVAILABLE'|'RECORDED'; correlation: 'NOT_ESTIMATED'; unavailable: string[] };
};

const finite = (value: unknown) => value == null || String(value).trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const round = (n: number) => Math.round(n * 1000) / 1000;
const mean = (rows: IntegralTrade[]) => rows.length ? round(rows.reduce((n, t) => n + Number(t.result_r), 0) / rows.length) : null;
const time = (s: string | null | undefined) => s ? Date.parse(s) : NaN;
function dateKey(value: string, timezone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}
function hour(value: string, timezone: string) {
  return new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }).format(new Date(value));
}

// Pure evidence layer: no order tools, no account writes, no inferred market data.
export function buildIntegralIntelligence(input: {
  userId: string; summary: LearningSummary; trades: IntegralTrade[];
  memories?: Array<{ id: string; category: string; content: string }>;
  responses?: Array<{ intervention_key: string; response: string | null; responded_at?: string | null }>;
  settings?: IntegralSettings; now?: Date; historyLimit?: number;
  scans?: Array<{id:string;user_id:string;instrument:string;analysis:unknown}>;
  accounts?:Array<{id:string;user_id:string;name:string;currency:string;current_balance:unknown;peak_balance:unknown}>;
  experiments?:ShadowExperiment[];
  collective?:Array<{dimension:string;bucket:string;trades:number;contributor_count:number;average_r:number}>;
}): IntegralState {
  const now = input.now ?? new Date(input.summary.generatedAt);
  const summary = input.summary;
  const known = new Set(summary.evidenceIds);
  const own = [...new Map(input.trades.filter(t => t.user_id === input.userId && !isTradeLifecycleSimulationRecord(t)).map(t => [t.id, t])).values()];
  const closed = own.filter(t => known.has(t.id) && t.status === 'CLOSED' && finite(t.result_r) !== null && time(t.closed_at) <= now.getTime())
    .sort((a, b) => time(a.closed_at) - time(b.closed_at) || a.id.localeCompare(b.id));
  const open = own.filter(t => t.status === 'OPEN' && time(t.opened_at) <= now.getTime());
  const signals: IntegralSignal[] = [];
  const personalContexts=new Set(summary.dimensions.map(d=>`${d.dimension}:${d.dimension==='hour'||d.dimension==='weekday'?`${summary.timezone}|${d.key}`:d.key}`));
  const collectiveHypotheses:IntegralState['collectiveHypotheses']=(input.collective??[]).filter(p=>p.contributor_count>=20&&p.trades>=100&&Number.isFinite(Number(p.average_r))&&personalContexts.has(`${p.dimension}:${p.bucket}`)).slice(0,6)
    .map(p=>({dimension:p.dimension,bucket:p.bucket,trades:p.trades,contributors:p.contributor_count,averageR:Number(p.average_r),source:'AGGREGATE_HYPOTHESIS'}));
  const accounts=(input.accounts??[]).filter(a=>a.user_id===input.userId).map(a=>{const balance=finite(a.current_balance),peak=finite(a.peak_balance);return {id:a.id,name:a.name,currency:a.currency,balance,drawdownPercent:balance!==null&&peak!==null&&peak>0?round(Math.max(0,100*(peak-balance)/peak)):null};});
  const resultBasis={netRecorded:closed.filter(t=>t.net_result_basis===true).length,feeImpactUnknown:closed.filter(t=>t.net_result_basis!==true).length};
  const markets: RecordedMarketObservation[]=[];
  const instruments=new Set<string>();
  const minutes:Record<string,number>={M1:1,M3:3,M5:5,M15:15,M30:30,H1:60,H2:120,H4:240,H6:360,H8:480,H12:720,D1:1440,W1:10080};
  for(const scan of input.scans??[]){
    if(scan.user_id!==input.userId||instruments.has(scan.instrument)||!scan.analysis||typeof scan.analysis!=='object')continue;
    instruments.add(scan.instrument);
    const a=scan.analysis as Record<string,unknown>;
    if(a.instrument!==scan.instrument||a.analysisStatus!=='VALID_ANALYSIS'||typeof a.timeframe!=='string'||typeof a.calculatedAt!=='string'||typeof a.latestCandleTimestamp!=='string')continue;
    const frames=a.timeframes;
    if(!frames||typeof frames!=='object')continue;
    const raw=(frames as Record<string,unknown>)[a.timeframe];
    if(!raw||typeof raw!=='object')continue;
    const frame=raw as Record<string,unknown>, atr=finite(frame.atr);
    if(!['BULLISH','BEARISH','RANGE'].includes(String(frame.bias))||atr===null||atr<=0)continue;
    const calculated=time(a.calculatedAt),latest=time(a.latestCandleTimestamp);
    if(!Number.isFinite(calculated)||!Number.isFinite(latest)||calculated>now.getTime()||latest>now.getTime())continue;
    const ttl=(minutes[a.timeframe]??0)*2*60_000;
    markets.push({scanId:scan.id,instrument:scan.instrument,strategyId:typeof a.strategyId==='string'?a.strategyId:null,timeframe:a.timeframe,bias:frame.bias as RecordedMarketObservation['bias'],atr,
      calculatedAt:a.calculatedAt,latestCandleAt:a.latestCandleTimestamp,freshness:ttl>0&&now.getTime()-calculated<=ttl&&now.getTime()-latest<=ttl?'RECENT':'STALE'});
  }
  const signal = (s: IntegralSignal) => signals.push(s);
  const historyLimit = input.historyLimit ?? 300;
  const potentiallyTruncated = input.trades.filter(t => t.status === 'CLOSED').length >= historyLimit;
  if (summary.excludedTrades || potentiallyTruncated) signal({ key: 'quality:history', category: 'QUALITY', severity: 'CAUTION', title: 'History has coverage limits',
    detail: `${summary.excludedTrades} excluded records. Retrieval is limited to ${historyLimit} recent closed executions; missing history cannot establish a lifetime pattern.`, evidenceIds: [], sampleSize: closed.length });

  const exposureGroups = new Map<string | null, IntegralTrade[]>();
  for (const t of open) exposureGroups.set(t.account_id ?? null, [...(exposureGroups.get(t.account_id ?? null) ?? []), t]);
  const exposure = [...exposureGroups].map(([accountId, rows]) => ({ accountId, positions: rows.length,
    knownRiskPercent: round(rows.reduce((n, t) => { const r = finite(t.risk_percent); return n + (r !== null && r > 0 && r <= 100 ? r : 0); }, 0)),
    missingRisk: rows.filter(t => { const r = finite(t.risk_percent); return r === null || r <= 0 || r > 100; }).length,
    staleQuotes: rows.filter(t => !Number.isFinite(time(t.last_price_at)) || time(t.last_price_at) > now.getTime() || now.getTime() - time(t.last_price_at) > 5 * 60_000).length,
    evidenceIds: rows.map(t => t.id) }));
  for (const group of exposure) if (group.missingRisk || group.staleQuotes) signal({ key: `exposure:coverage:${group.accountId ?? 'unassigned'}`, category: 'EXPOSURE', severity: 'CAUTION',
    title: 'Position monitoring needs current evidence', detail: `${group.positions} open positions; ${group.missingRisk} have unknown risk and ${group.staleQuotes} lack a quote within five minutes. Recorded risk is not current mark-to-market exposure.`, evidenceIds: group.evidenceIds, sampleSize: group.positions });
  const clustered = new Map<string, IntegralTrade[]>();
  for (const t of open) { const key = `${t.account_id ?? 'unassigned'}:${t.instrument}:${t.direction}`; clustered.set(key, [...(clustered.get(key) ?? []), t]); }
  for (const [key, rows] of clustered) if (rows.length >= 2) signal({ key: `exposure:cluster:${key}`, category: 'EXPOSURE', severity: 'CAUTION', title: 'Repeated exposure in the same direction',
    detail: `${rows.length} positions share an account, instrument and direction. This detects concentration, not measured cross-market correlation.`, evidenceIds: rows.map(t => t.id), sampleSize: rows.length });

  const groups = new Map<string, IntegralTrade[]>();
  for (const t of closed) if (Number.isFinite(time(t.opened_at)) && t.strategy_profile_id && t.instrument) {
    const key = JSON.stringify([t.strategy_profile_id, t.instrument, hour(t.opened_at!, summary.timezone)]);
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const combinations = [...groups].filter(([, rows]) => rows.length >= 5).map(([key, rows]) => ({ key,
    label: `${rows[0].strategy_name_at_entry ?? rows[0].strategy_profile_id} · ${rows[0].instrument} · ${hour(rows[0].opened_at!, summary.timezone)}:00`,
    trades: rows.length, averageR: mean(rows)!, evidenceIds: rows.map(t => t.id), evidence: assessPatternEvidence(rows, now, summary.timezone) }))
    .sort((a, b) => b.trades - a.trades || a.key.localeCompare(b.key)).slice(0, 12);

  const recent = closed.slice(-20), baseline = closed.slice(-60, -20);
  const baselineR = baseline.length >= 20 ? mean(baseline) : null;
  const recentR = recent.length >= 20 ? mean(recent) : null;
  const changeR = baselineR !== null && recentR !== null ? round(recentR - baselineR) : null;
  const drift = { baselineTrades: baseline.length, recentTrades: recent.length, baselineR, recentR, changeR };
  if (changeR !== null && changeR <= -0.5) signal({ key: 'drift:performance', category: 'DRIFT', severity: 'CAUTION', title: 'Recent results differ from your baseline',
    detail: `Recent 20 executions average ${recentR}R versus ${baselineR}R in the preceding ${baseline.length}. Compare strategy mix and execution before attributing the change to skill or market regime.`, evidenceIds: [...baseline, ...recent].map(t => t.id), sampleSize: baseline.length + recent.length });

  // Only outcomes actually closed before entry may identify a re-entry after loss.
  const entries = closed.filter(t => Number.isFinite(time(t.opened_at))).sort((a, b) => time(a.opened_at) - time(b.opened_at));
  const reentries: string[] = [];
  const longSessions: IntegralTrade[] = [];
  const firstByDay = new Map<string, number>();
  for (const t of entries) {
    const prior = closed.filter(p => p.id !== t.id && time(p.closed_at) < time(t.opened_at)).at(-1);
    const risk = finite(t.risk_percent), priorRisk = finite(prior?.risk_percent);
    if (prior && Number(prior.result_r) < 0 && time(t.opened_at) - time(prior.closed_at) <= 15 * 60_000 && risk !== null && priorRisk !== null && priorRisk > 0 && risk > priorRisk * 1.25) reentries.push(t.id, prior.id);
    const day = dateKey(t.opened_at!, summary.timezone);
    if (!firstByDay.has(day)) firstByDay.set(day, time(t.opened_at));
    if (time(t.opened_at) - firstByDay.get(day)! >= 4 * 60 * 60_000) longSessions.push(t);
  }
  if (reentries.length >= 6) signal({ key: 'behavior:reentry-risk', category: 'BEHAVIOR', severity: 'CAUTION', title: 'Repeated risk increases after a loss',
    detail: `${reentries.length / 2} recorded entries within 15 minutes of a loss used over 25% more risk. This is an observable sequence; it does not identify an emotion or intent.`, evidenceIds: [...new Set(reentries)], sampleSize: reentries.length / 2 });
  if (longSessions.length >= 10 && mean(longSessions)! < 0) signal({ key: 'behavior:long-session', category: 'BEHAVIOR', severity: 'CAUTION', title: 'Review entries late in your trading day',
    detail: `${longSessions.length} entries four hours after the first recorded daily entry average ${mean(longSessions)}R. Session length is an approximation from recorded entries, not a fatigue diagnosis.`, evidenceIds: longSessions.map(t => t.id), sampleSize: longSessions.length });

  const reviews = closed.slice(-5).reverse().map(t => ({ tradeId: t.id, process: t.taken_against_verdict === true ? 'OVERRIDDEN' as const : t.taken_against_verdict === false ? 'FOLLOWED' as const : 'UNKNOWN' as const,
    resultR: Number(t.result_r), interpretation: t.taken_against_verdict === false
      ? 'The verdict was followed. A recorded loss alone is not proof of poor execution.'
      : t.taken_against_verdict === true ? 'The verdict was overridden. Review the recorded reason separately from the outcome.' : 'Adherence was not recorded; execution quality cannot be inferred.' }));
  const weeklyTrades = closed.filter(t => time(t.closed_at) >= now.getTime() - 7 * 86400000);
  const adherence = (rows: IntegralTrade[]) => { const knownRows = rows.filter(t => typeof t.taken_against_verdict === 'boolean'); return knownRows.length ? round(100 * knownRows.filter(t => t.taken_against_verdict === false).length / knownRows.length) : null; };
  const weekly = { trades: weeklyTrades.length, averageR: mean(weeklyTrades), adherenceRate: adherence(weeklyTrades), knownAdherence: weeklyTrades.filter(t => typeof t.taken_against_verdict === 'boolean').length, evidenceIds: weeklyTrades.map(t => t.id) };
  const focus = reentries.length >= 6 ? 'RISK_CONSISTENCY' : summary.behavior.overrideTrades >= 3 ? 'RULE_ADHERENCE' : closed.length < 20 ? 'EVIDENCE_BASE' : changeR !== null && changeR <= -0.5 ? 'EXECUTION_REVIEW' : 'PROCESS_CONSISTENCY';
  const actions = { RISK_CONSISTENCY: 'Review the next five entries for risk changes after a loss; record your reason before entry.', RULE_ADHERENCE: 'For the next five executions, record whether the verdict was followed and explain each override.', EVIDENCE_BASE: 'Record entry time, risk, adherence and closure for the next five executions.', EXECUTION_REVIEW: 'Compare five recent executions with earlier ones using the same strategy and instrument.', PROCESS_CONSISTENCY: 'Review five executions for process consistency, independently of whether they won.' };
  const training = { focus, action: actions[focus], evidenceIds: summary.recommendations[0]?.evidenceIds ?? closed.slice(-5).map(t => t.id), progress: { current: adherence(closed.slice(-10)), previous: closed.length >= 20 ? adherence(closed.slice(-20, -10)) : null, sampleSize: Math.min(10, closed.length) } };

  // Retrospective discovery/validation split; never claim a preregistered prospective experiment.
  const split = Math.floor(closed.length * 2 / 3), discovery = closed.slice(0, split), validation = closed.slice(split);
  const laboratory: IntegralState['laboratory'] = [];
  for (const kind of ['OVERRIDE', 'LATE_SESSION'] as const) {
    const lateIds = new Set(longSessions.map(t => t.id));
    const excluded = (t: IntegralTrade) => kind === 'OVERRIDE' ? t.taken_against_verdict === true : lateIds.has(t.id);
    const before = discovery.filter(excluded), after = validation.filter(excluded);
    if (before.length < 5 || mean(before)! >= 0) continue;
    const comparison = (rows: IntegralTrade[]) => { const kept = rows.filter(t => !excluded(t)); return kept.length >= 5 ? round(mean(kept)! - mean(rows)!) : null; };
    const discoveryChangeR = comparison(discovery), validationChangeR = comparison(validation);
    const separated = validation.length > 0 && time(validation[0].opened_at) > time(discovery.at(-1)?.closed_at);
    const status = after.length < 5 || validation.length < 10 || !separated || validationChangeR === null ? 'INSUFFICIENT' : validationChangeR > 0 ? 'SUPPORTED' : 'CONFLICTING';
    laboratory.push({ key: kind, hypothesis: kind === 'OVERRIDE' ? 'Review a process that avoids recorded verdict overrides.' : 'Review a shorter daily entry window.', status,
      discoveryExcluded: before.length, validationExcluded: after.length, discoveryChangeR, validationChangeR,
      evidenceIds: [...discovery, ...validation].map(t => t.id), automaticChanges: false });
  }
  const responses = input.responses ?? [];
  const settings = input.settings ?? { collectiveOptIn: false, mutedKeys: [] };
  const ranked = signals.filter(s => s.severity === 'PAUSE' || s.category === 'QUALITY' || s.category === 'EXPOSURE' || !settings.mutedKeys.includes(s.key))
    .sort((a, b) => (b.severity === 'PAUSE' ? 2 : b.severity === 'CAUTION' ? 1 : 0) - (a.severity === 'PAUSE' ? 2 : a.severity === 'CAUTION' ? 1 : 0) || b.sampleSize - a.sampleSize);
  return { version: '1', generatedAt: now.toISOString(), source: 'RECORDED', controlsVerdict: false, signals: ranked, markets, accounts, resultBasis, collectiveHypotheses, experiments:(input.experiments??[]).map(e=>({...e,evaluation:e.status==='EVALUATED'&&e.outcome&&typeof e.outcome==='object'&&'status' in e.outcome&&e.outcome.status==='EVALUATED'?e.outcome as ReturnType<typeof evaluateShadowExperiment>:evaluateShadowExperiment(e,closed,now)})), exposure, combinations, drift, reviews, weekly, training, laboratory,
    feedback: { responses: responses.length, helpful: responses.filter(r => r.response === 'HELPFUL').length, notHelpful: responses.filter(r => r.response === 'NOT_HELPFUL').length, causalBenefitEstablished: false },
    memory: (input.memories ?? []).map(m => ({ ...m, source: 'TRADER_STATED', authoritative: false })),
    quality: { historyLimit, potentiallyTruncated, brokerVerified: false, marketRegime:markets.length?'RECORDED':'UNAVAILABLE', correlation: 'NOT_ESTIMATED', unavailable: ['Broker reconciliation', 'Measured cross-market correlation', 'Live spread and news', 'Causal recommendation benefit'] } };
}

// TP's realized_pnl is already net of fees. Never subtract them a second time.
export function normalizeRecordedResult<T extends IntegralTrade>(trade:T):T {
  const risk=finite(trade.risk_amount),pnl=finite(trade.realized_pnl);
  return risk!==null&&risk>0&&pnl!==null?{...trade,result_r:round(pnl/risk),net_result_basis:true}:{...trade,net_result_basis:false};
}
