'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import InstrumentSelector, { CatalogInstrument } from '@/components/InstrumentSelector';
import SessionSelector, { PRESET_SESSIONS } from '@/components/SessionSelector';
import RuleBuilder, { DEFAULT_RULES } from '@/components/RuleBuilder';
import RiskSettings from '@/components/RiskSettings';
import StopLimitBuilder from '@/components/StopLimitBuilder';
import StrategyPersonalization from '@/components/StrategyPersonalization';
import StrategyLearningConfirmation from '@/components/StrategyLearningConfirmation';
import MethodologyVerification from '@/components/MethodologyVerification';
import { DEFAULT_STRATEGY_PROFILE } from '@/types/trade';
import type { EvidenceKey, StopLimit, StrategyProfile, StrategyRule, StrategySession } from '@/types/trade';
import { normalizeStrategyProfile } from '@/lib/strategy-policy';
import { apiErrorMessage } from '@/lib/api-error';
import { trackBetaEvent, trackBetaEventOnce } from '@/lib/beta-intelligence';

const TIMEFRAMES = ['M1','M3','M5','M15','M30','H1','H2','H4','H6','H8','H12','D1','W1','MN'];
const BUILDER_STEPS = [
  ['identity','Your approach'],['markets','What you trade'],['schedule','When you trade'],['timeframes','How you read price'],['risk','Protect capital'],['rules','Confirm a trade'],['management','Manage the trade'],['review','Review your playbook']
] as const;
type BuilderStep = typeof BUILDER_STEPS[number][0];

const SETUPS = ['Trend Continuation','Liquidity Sweep Reversal','Breakout and Retest','Order Block Continuation','FVG Continuation','London Breakout','New York Reversal','Range Reversal','Momentum Breakout','Swing Pullback'];

const FALLBACK_CATALOG: CatalogInstrument[] = [
  ['EURUSD','Euro / US Dollar','MAJOR'],['GBPUSD','British Pound / US Dollar','MAJOR'],['USDJPY','US Dollar / Japanese Yen','MAJOR'],['USDCHF','US Dollar / Swiss Franc','MAJOR'],['AUDUSD','Australian Dollar / US Dollar','MAJOR'],['USDCAD','US Dollar / Canadian Dollar','MAJOR'],['NZDUSD','New Zealand Dollar / US Dollar','MAJOR'],
  ['EURGBP','Euro / British Pound','MINOR'],['EURJPY','Euro / Japanese Yen','CROSS'],['EURCHF','Euro / Swiss Franc','MINOR'],['EURAUD','Euro / Australian Dollar','CROSS'],['EURCAD','Euro / Canadian Dollar','CROSS'],['EURNZD','Euro / New Zealand Dollar','CROSS'],['GBPJPY','British Pound / Japanese Yen','CROSS'],['GBPCHF','British Pound / Swiss Franc','CROSS'],['GBPAUD','British Pound / Australian Dollar','CROSS'],['GBPCAD','British Pound / Canadian Dollar','CROSS'],['GBPNZD','British Pound / New Zealand Dollar','CROSS'],['AUDJPY','Australian Dollar / Japanese Yen','CROSS'],['AUDNZD','Australian Dollar / New Zealand Dollar','CROSS'],['AUDCAD','Australian Dollar / Canadian Dollar','CROSS'],['AUDCHF','Australian Dollar / Swiss Franc','CROSS'],['CADJPY','Canadian Dollar / Japanese Yen','CROSS'],['CADCHF','Canadian Dollar / Swiss Franc','CROSS'],['CHFJPY','Swiss Franc / Japanese Yen','CROSS'],['NZDJPY','New Zealand Dollar / Japanese Yen','CROSS'],['NZDCAD','New Zealand Dollar / Canadian Dollar','CROSS'],['NZDCHF','New Zealand Dollar / Swiss Franc','CROSS'],
  ['USDNOK','US Dollar / Norwegian Krone','EXOTIC'],['USDSEK','US Dollar / Swedish Krona','EXOTIC'],['USDMXN','US Dollar / Mexican Peso','EXOTIC'],['USDZAR','US Dollar / South African Rand','EXOTIC'],['USDTRY','US Dollar / Turkish Lira','EXOTIC'],
  ['XAUUSD','Gold / US Dollar','METAL'],['XAGUSD','Silver / US Dollar','METAL'],
].map(([symbol, displayName, category]) => ({ symbol, displayName, category, marketType: category === 'METAL' ? 'METALS' : 'FOREX' }));

function cloneDefault(): StrategyProfile {
  return JSON.parse(JSON.stringify(DEFAULT_STRATEGY_PROFILE));
}

function profileFromRow(row: any): StrategyProfile {
  return normalizeStrategyProfile({
    id: row.id,
    engineVersion:Number(row.engine_version??(row.macro_timeframe&&row.trigger_timeframe?2:1)),
    name: row.name,
    description: row.description ?? '',
    isDefault: row.is_default,
    isArchived: row.is_archived,
    marketTypes: row.market_types ?? ['FOREX'],
    instruments: row.instruments ?? [],
    macroTimeframe: row.macro_timeframe ?? 'D1',
    trendTimeframe: row.trend_timeframe,
    confirmationTimeframe: row.confirmation_timeframe,
    entryTimeframe: row.entry_timeframe,
    triggerTimeframe: row.trigger_timeframe ?? 'M5',
    minimumRR: Number(row.minimum_rr),
    preferredRR: Number(row.preferred_rr ?? row.minimum_rr),
    maximumRiskPercent: Number(row.maximum_risk_percent),
    maximumDailyRiskPercent: Number(row.maximum_daily_risk_percent ?? 1.5),
    maximumWeeklyRiskPercent: Number(row.maximum_weekly_risk_percent ?? 4),
    maximumDailyLossPercent: Number(row.maximum_daily_loss_percent ?? 2),
    maximumTotalExposurePercent: Number(row.maximum_total_exposure_percent ?? 2),
    maximumCurrencyExposurePercent: Number(row.maximum_currency_exposure_percent ?? 1),
    maximumTradesPerDay: row.maximum_trades_per_day,
    instrumentTradeLimits: row.instrument_trade_limits ?? {},
    greenDayProtectionEnabled: Boolean(row.green_day_protection_enabled),
    greenDayProtectedFloorMode: row.green_day_protected_floor_mode ?? 'ZERO',
    greenDayProtectedFloorValue: Number(row.green_day_protected_floor_value ?? 0),
    greenDayMaxExtraTrades: Number(row.green_day_max_extra_trades ?? 1),
    greenDayExtraRiskMultiplier: Number(row.green_day_extra_risk_multiplier ?? 0.5),
    greenDayRequireAuthorized: row.green_day_require_authorized !== false,
    maximumConsecutiveLosses: row.maximum_consecutive_losses ?? row.loss_streak_limit,
    allowedSessions: row.allowed_sessions ?? [],
    avoidHighImpactNews: row.avoid_high_impact_news,
    newsMode: row.news_mode ?? 'RELEVANT_CURRENCIES',
    newsBlockMinutesBefore: row.news_block_minutes_before ?? 30,
    newsBlockMinutesAfter: row.news_block_minutes_after ?? 15,
    newsCurrencies: row.news_currencies ?? ['USD','GBP','JPY'],
    requireTrendAlignment: row.require_trend_alignment,
    requiredEvidence: row.required_evidence ?? [],
    evidenceWeights: row.evidence_weights ?? cloneDefault().evidenceWeights,
    stopLimits: row.stop_limits ?? {},
    authorizationScore: row.authorization_score,
    waitScore: row.wait_score,
    lossStreakLimit: row.loss_streak_limit,
    preferredSetups: row.preferred_setups ?? [],
    rejectUnlistedSetups: row.reject_unlisted_setups ?? false,
    trailingConfig: row.trailing_config ?? {},
    exitConfig: row.exit_config ?? {},
    monitorConfig: row.monitor_config ?? {},
    tradingStyle: row.trading_style ?? 'day-trading',
    minimumHoldingMinutes: Number(row.minimum_holding_minutes ?? 15),
    strategyMethodologies: row.strategy_methodologies ?? [],
    personalRules: row.personal_rules ?? [],
    aiBehavior: {...cloneDefault().aiBehavior,...(row.ai_behavior??{})},
  });
}

export default function StrategyBuilder({ userId }: { userId: string }) {
  const [profiles, setProfiles] = useState<StrategyProfile[]>([]);
  const [profile, setProfile] = useState<StrategyProfile>(cloneDefault());
  const [catalog, setCatalog] = useState<CatalogInstrument[]>(FALLBACK_CATALOG);
  const [sessions, setSessions] = useState<StrategySession[]>(PRESET_SESSIONS.filter((item) => ['LONDON','NEW_YORK'].includes(item.sessionCode)));
  const [rules, setRules] = useState<StrategyRule[]>(DEFAULT_RULES);
  const [stopLimits, setStopLimits] = useState<StopLimit[]>(cloneDefault().stopLimitSettings ?? []);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userTimezone, setUserTimezone] = useState('America/Monterrey');
  const [builderStep, setBuilderStep] = useState<BuilderStep>('identity');
  const [deleteTarget, setDeleteTarget] = useState<StrategyProfile|null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [learningConfirmation, setLearningConfirmation] = useState<{profile:StrategyProfile;rules:StrategyRule[]}|null>(null);
  const [verification, setVerification] = useState<{profile:StrategyProfile;rules:StrategyRule[]}|null>(null);
  const [refinementRequested, setRefinementRequested] = useState(false);

  useEffect(() => {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Monterrey';
    const saved = window.localStorage.getItem('trade-police-timezone');
    setUserTimezone(saved || detected);
    void loadAll();
    void trackBetaEventOnce('ONBOARDING_STARTED');
  }, [userId]);

  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem('trade-police-strategy-draft', JSON.stringify({ profile, sessions, rules, stopLimits }));
  }, [profile, sessions, rules, stopLimits]);

  useEffect(() => {
    setStopLimits((current) => {
      const bySymbol = new Map(current.map((limit) => [limit.instrument, limit]));
      return profile.instruments.map((symbol) => bySymbol.get(symbol) ?? { instrument: symbol, method: symbol.startsWith('XAU') || symbol.startsWith('XAG') ? 'POINTS' : 'PIPS', minimumValue: symbol.startsWith('XAU') ? 80 : 10, preferredValue: symbol.startsWith('XAU') ? 180 : 18, maximumValue: symbol.startsWith('XAU') ? 300 : 25 });
    });
  }, [profile.instruments]);

  function updateUserTimezone(timezone: string) {
    setUserTimezone(timezone);
    window.localStorage.setItem('trade-police-timezone', timezone);
  }

  async function loadAll(selectId?: string) {
    const supabase = createClient();
    const [{ data: profileRows, error: profileError }, { data: catalogRows }] = await Promise.all([
      supabase.from('strategy_profiles').select('*').order('is_archived', { ascending: true }).order('created_at', { ascending: true }),
      supabase.from('instrument_catalog').select('symbol,display_name,market_type,category').eq('is_active', true).order('symbol'),
    ]);

    if (profileError) {
      setMessage(`${profileError.message}. Run 004_strategy_builder.sql in Supabase.`);
      setLoading(false);
      return;
    }

    if (catalogRows?.length) setCatalog(catalogRows.map((row: any) => ({ symbol: row.symbol, displayName: row.display_name, marketType: row.market_type, category: row.category })));

    const mapped = (profileRows ?? []).map(profileFromRow);
    setProfiles(mapped);
    const target = mapped.find((item) => item.id === selectId) ?? mapped.find((item) => item.isDefault) ?? mapped[0];

    if (target) await openProfile(target);
    else startNew();
    setLoading(false);
  }

  async function openProfile(target: StrategyProfile) {
    setProfile(target);
    if (!target.id) return;
    const supabase = createClient();
    const [{ data: sessionRows }, { data: ruleRows }, { data: stopRows }, { data: instrumentRows }] = await Promise.all([
      supabase.from('strategy_sessions').select('*').eq('strategy_id', target.id).order('created_at'),
      supabase.from('strategy_rules').select('*').eq('strategy_id', target.id).order('sort_order'),
      supabase.from('strategy_stop_limits').select('*').eq('strategy_id', target.id),
      supabase.from('strategy_instruments').select('*').eq('strategy_id', target.id).eq('enabled', true).order('sort_order'),
    ]);

    if (instrumentRows?.length) setProfile((current) => ({ ...current, instruments: instrumentRows.map((row: any) => row.symbol) }));
    setSessions(sessionRows?.length ? sessionRows.map((row: any) => ({ id: row.id, sessionCode: row.session_code, name: row.name, timezone: row.timezone, startTime: row.start_time.slice(0,5), endTime: row.end_time.slice(0,5), days: row.days, allowOpenOutside: row.allow_open_outside, allowHoldOutside: row.allow_hold_outside, isCustom: row.is_custom })) : PRESET_SESSIONS.filter((item) => target.allowedSessions.includes(item.sessionCode)));
    setRules(ruleRows?.length ? ruleRows.map((row: any) => ({ ruleKey: row.rule_key, label: row.label, enabled: row.enabled, mandatory: row.mandatory, weight: Number(row.weight), minimumConfidence: row.minimum_confidence, timeframeRole: row.timeframe_role, evaluationMode:row.evaluation_mode??'AUTOMATIC' })) : DEFAULT_RULES.map((rule) => ({ ...rule, mandatory: target.requiredEvidence.includes(rule.ruleKey as EvidenceKey), weight: target.evidenceWeights[rule.ruleKey as EvidenceKey] ?? rule.weight })));
    setStopLimits(stopRows?.length ? stopRows.map((row: any) => ({ instrument: row.instrument, method: row.method, minimumValue: Number(row.minimum_value ?? 0), preferredValue: Number(row.preferred_value ?? row.maximum_value), maximumValue: Number(row.maximum_value), atrMultiplier: row.atr_multiplier === null ? undefined : Number(row.atr_multiplier) })) : target.instruments.map((symbol) => ({ instrument: symbol, method: 'PIPS', minimumValue: 10, preferredValue: 18, maximumValue: 25 })));
    setMessage('');
  }

  function startNew() {
    const next = cloneDefault();
    next.id = undefined;
    next.name = 'New Strategy';
    next.isDefault = profiles.length === 0;
    setProfile(next);
    setSessions(PRESET_SESSIONS.filter((item) => ['LONDON','NEW_YORK'].includes(item.sessionCode)));
    setRules(DEFAULT_RULES);
    setStopLimits(next.stopLimitSettings ?? []);
    setMessage('Creating a new strategy profile.');
  }

  async function save() {
    if (!profile.name.trim()) return setMessage('Strategy name is required.');
    if (profile.instruments.length === 0) return setMessage('Select at least one instrument.');
    if (profile.waitScore >= profile.authorizationScore) return setMessage('WAIT score must be lower than AUTHORIZED score.');
    const updatingExisting=Boolean(profile.id);
    setSaving(true);
    setMessage('');
    try {
    const enabledRules = rules.filter((rule) => rule.enabled);
    const evidenceWeights = { ...profile.evidenceWeights };
    enabledRules.forEach((rule) => {
      if (rule.ruleKey in evidenceWeights) evidenceWeights[rule.ruleKey as EvidenceKey] = rule.weight;
    });
    const requiredEvidence = enabledRules.filter((rule) => rule.mandatory && rule.ruleKey in evidenceWeights).map((rule) => rule.ruleKey as EvidenceKey);
    const legacyStopLimits = { ...profile.stopLimits };
    stopLimits.forEach((limit) => { legacyStopLimits[limit.instrument] = limit.maximumValue; });

    const normalized=normalizeStrategyProfile(profile);
    const row = {
      engine_version:2,
      name: profile.name.trim(),
      description: profile.description ?? '',
      is_default: Boolean(profile.isDefault),
      is_archived: false,
      market_types: profile.marketTypes ?? ['FOREX'],
      instruments: profile.instruments,
      macro_timeframe: profile.macroTimeframe,
      trend_timeframe: profile.trendTimeframe,
      confirmation_timeframe: profile.confirmationTimeframe,
      entry_timeframe: profile.entryTimeframe,
      trigger_timeframe: profile.triggerTimeframe,
      minimum_rr: profile.minimumRR,
      preferred_rr: profile.preferredRR,
      maximum_risk_percent: profile.maximumRiskPercent,
      maximum_daily_risk_percent: profile.maximumDailyRiskPercent,
      maximum_weekly_risk_percent: profile.maximumWeeklyRiskPercent,
      maximum_daily_loss_percent: profile.maximumDailyLossPercent,
      maximum_total_exposure_percent: profile.maximumTotalExposurePercent,
      maximum_currency_exposure_percent: profile.maximumCurrencyExposurePercent,
      maximum_trades_per_day: profile.maximumTradesPerDay,
      instrument_trade_limits: profile.instrumentTradeLimits ?? {},
      green_day_protection_enabled: Boolean(profile.greenDayProtectionEnabled),
      green_day_protected_floor_mode: profile.greenDayProtectedFloorMode ?? 'ZERO',
      green_day_protected_floor_value: profile.greenDayProtectedFloorValue ?? 0,
      green_day_max_extra_trades: profile.greenDayMaxExtraTrades ?? 1,
      green_day_extra_risk_multiplier: profile.greenDayExtraRiskMultiplier ?? 0.5,
      green_day_require_authorized: profile.greenDayRequireAuthorized !== false,
      maximum_consecutive_losses: profile.maximumConsecutiveLosses,
      allowed_sessions: sessions.map((item) => item.sessionCode),
      avoid_high_impact_news: profile.newsMode !== 'ALLOW',
      news_mode: profile.newsMode,
      news_block_minutes_before: profile.newsBlockMinutesBefore,
      news_block_minutes_after: profile.newsBlockMinutesAfter,
      news_currencies: profile.newsCurrencies,
      require_trend_alignment: profile.requireTrendAlignment,
      required_evidence: requiredEvidence,
      evidence_weights: evidenceWeights,
      stop_limits: legacyStopLimits,
      authorization_score: profile.authorizationScore,
      wait_score: profile.waitScore,
      loss_streak_limit: profile.maximumConsecutiveLosses ?? profile.lossStreakLimit,
      preferred_setups: profile.preferredSetups ?? [],
      reject_unlisted_setups: profile.rejectUnlistedSetups ?? false,
      trailing_config: profile.trailingConfig ?? {},
      exit_config: profile.exitConfig ?? {},
      monitor_config: profile.monitorConfig ?? {},
      trading_style: profile.tradingStyle ?? 'day-trading',
      minimum_holding_minutes: profile.minimumHoldingMinutes ?? 0,
      strategy_methodologies: profile.strategyMethodologies ?? [],
      personal_rules: profile.personalRules ?? [],
      ai_behavior: normalized.aiBehavior,
    };
    const response=await fetch('/api/strategies/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      strategyId:profile.id??null,activate:Boolean(profile.isDefault),profile:row,
      instruments:profile.instruments.map((symbol,index)=>({symbol,market_type:symbol.startsWith('XAU')||symbol.startsWith('XAG')?'METALS':'FOREX',provider_symbol:null,sort_order:index,enabled:true})),
      sessions:sessions.map(session=>({session_code:session.sessionCode,name:session.name,timezone:session.timezone,start_time:session.startTime,end_time:session.endTime,days:session.days,allow_open_outside:session.allowOpenOutside,allow_hold_outside:session.allowHoldOutside,is_custom:Boolean(session.isCustom)})),
      rules:rules.map((rule,index)=>({rule_key:rule.ruleKey,label:rule.label,enabled:rule.enabled,mandatory:rule.mandatory,weight:rule.weight,minimum_confidence:rule.minimumConfidence,timeframe_role:rule.timeframeRole,evaluation_mode:rule.evaluationMode??'AUTOMATIC',sort_order:index})),
      stopLimits:stopLimits.filter(limit=>limit.maximumValue>0).map(limit=>({instrument:limit.instrument,method:limit.method,minimum_value:limit.minimumValue??0,preferred_value:limit.preferredValue??limit.maximumValue,maximum_value:limit.maximumValue,atr_multiplier:limit.atrMultiplier??null})),
    })});
    const result=await response.json();
    if(!response.ok)throw new Error(apiErrorMessage(result,'Could not save strategy.'));
    if(!result.strategyId||result.saved!==true)throw new Error('Strategy was not returned after saving.');
    const savedProfile:StrategyProfile={...normalized,...profile,id:result.strategyId,allowedSessions:sessions.map(item=>item.sessionCode),requiredEvidence,evidenceWeights,rules:[...rules],stopLimits:legacyStopLimits,stopLimitSettings:[...stopLimits]};
    await loadAll(result.strategyId);
    setMessage('');
    if(refinementRequested){setVerification({profile:savedProfile,rules:[...rules]});setLearningConfirmation(null);setRefinementRequested(false)}
    else setLearningConfirmation({profile:savedProfile,rules:[...rules]});
    void trackBetaEvent(updatingExisting?'PLAYBOOK_UPDATED':'PLAYBOOK_CREATED',result.strategyId);
    window.dispatchEvent(new CustomEvent('trade-police:strategy-changed',{detail:{strategyId:result.strategyId}}));
    } catch (error) {
      setMessage(error instanceof Error&&error.message.startsWith('Could not save strategy:')?error.message:`Could not save strategy: ${error instanceof Error?error.message:'Unknown persistence error.'}`);
    } finally {
      setSaving(false);
    }
  }

  async function setActive(target: StrategyProfile) {
    if (!target.id) return;
    const { error } = await createClient().rpc('set_active_strategy', { target_strategy_id: target.id });
    if (error) return setMessage(error.message);
    await loadAll(target.id);
    setMessage(`${target.name} is now the active strategy.`);
    window.dispatchEvent(new CustomEvent('trade-police:strategy-changed', { detail: { strategyId: target.id } }));
  }

  async function duplicate(target: StrategyProfile) {
    const copy = { ...target, id: undefined, name: `${target.name} Copy`, isDefault: false };
    await openProfile(target);
    setProfile(copy);
    setMessage('Strategy duplicated in the editor. Rename it and press Save strategy.');
    void trackBetaEvent('PLAYBOOK_DUPLICATED',target.id);
  }

  async function archive(target: StrategyProfile) {
    if (!target.id || target.isDefault) return setMessage('Activate another strategy before archiving this one.');
    const { error } = await createClient().from('strategy_profiles').update({ is_archived: true, updated_at: new Date().toISOString() }).eq('id', target.id);
    if (error) return setMessage(error.message);
    await loadAll();
    setMessage(`${target.name} was archived.`);
    void trackBetaEvent('PLAYBOOK_ARCHIVED',target.id);
  }

  async function restore(target: StrategyProfile) {
    if (!target.id) return;
    const { error } = await createClient().from('strategy_profiles').update({ is_archived: false, updated_at: new Date().toISOString() }).eq('id', target.id);
    if (error) return setMessage(error.message);
    await loadAll(target.id);
    setMessage(`${target.name} was restored.`);
    void trackBetaEvent('PLAYBOOK_RESTORED',target.id);
  }

  async function deletePlaybook() {
    if (!deleteTarget?.id || deleteConfirmation !== 'DELETE') return;
    setSaving(true);
    try {
      const response=await fetch('/api/strategies/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({strategyId:deleteTarget.id,confirmation:deleteConfirmation})});
      const result=await response.json();
      if(!response.ok)throw new Error(apiErrorMessage(result,'Could not delete playbook.'));
      const deletedName=deleteTarget.name;
      setDeleteTarget(null);
      setDeleteConfirmation('');
      await loadAll();
      setMessage(`${deletedName} was deleted. Historical analyses were preserved.`);
      void trackBetaEvent('PLAYBOOK_DELETED',deleteTarget.id);
      window.dispatchEvent(new CustomEvent('trade-police:strategy-changed'));
    } catch (error) {
      setMessage(error instanceof Error?error.message:'Could not delete playbook.');
    } finally {
      setSaving(false);
    }
  }

  const selectedProfile = useMemo(() => profiles.find((item) => item.id === profile.id), [profiles, profile.id]);
  const activeProfiles = useMemo(() => profiles.filter((item) => !item.isArchived), [profiles]);
  const archivedProfiles = useMemo(() => profiles.filter((item) => item.isArchived), [profiles]);

  if (loading) return <div className="card"><p>Loading Strategy Builder…</p></div>;
  if (verification) return <MethodologyVerification profile={verification.profile} rules={verification.rules} onAccept={()=>{void trackBetaEvent('SIMULATION_APPROVED',verification.profile.id);void trackBetaEvent('ONBOARDING_COMPLETED',verification.profile.id);window.localStorage.setItem(`trade-police-methodology-confirmed:${verification.profile.id??'current'}`,'true');window.location.assign('/validate')}} onRefine={()=>{void trackBetaEvent('SIMULATION_REJECTED',verification.profile.id);void trackBetaEvent('METHODOLOGY_REJECTED',verification.profile.id);setVerification(null);setLearningConfirmation(null);setRefinementRequested(true);setBuilderStep('rules');setMessage('What did I miss? Update the rules, confirmations, thresholds, or any playbook setting, then save to verify again.')}}/>;
  if (learningConfirmation) return <StrategyLearningConfirmation profile={learningConfirmation.profile} rules={learningConfirmation.rules} onEdit={()=>{void trackBetaEvent('METHODOLOGY_REJECTED',learningConfirmation.profile.id);setLearningConfirmation(null);setBuilderStep('identity')}} onConfirm={()=>{void trackBetaEvent('METHODOLOGY_CONFIRMED',learningConfirmation.profile.id);setVerification(learningConfirmation);setLearningConfirmation(null)}}/>;

  return (
    <div className="strategy-builder-layout">
      <aside className="card strategy-sidebar">
        <div className="sidebar-head"><div><p className="muted">MY STRATEGIES</p><h2>Profiles</h2></div><button type="button" onClick={startNew}>+ Create</button></div>
        <div className="strategy-list">
          {activeProfiles.map((item) => (
            <button type="button" className={`strategy-list-item ${item.id === profile.id ? 'selected' : ''}`} key={item.id} onClick={() => void openProfile(item)}>
              <span>{item.isDefault ? '●' : '○'}</span><div><strong>{item.name}</strong><small>{item.isDefault ? 'ACTIVE' : `${item.instruments.length} instruments`}</small></div>
            </button>
          ))}
          {archivedProfiles.length>0&&<><p className="muted strategy-list-label">ARCHIVED</p>{archivedProfiles.map((item) => (
            <button type="button" className={`strategy-list-item archived ${item.id === profile.id ? 'selected' : ''}`} key={item.id} onClick={() => void openProfile(item)}>
              <span>◇</span><div><strong>{item.name}</strong><small>ARCHIVED · {item.instruments.length} instruments</small></div>
            </button>
          ))}</>}
        </div>
        {selectedProfile && <div className="stack sidebar-actions"><button type="button" onClick={()=>setBuilderStep('identity')}>Edit</button><button type="button" onClick={() => void duplicate(selectedProfile)}>Duplicate</button>{selectedProfile.isArchived?<button type="button" onClick={() => void restore(selectedProfile)}>Restore</button>:<><button type="button" onClick={() => void setActive(selectedProfile)} disabled={selectedProfile.isDefault}>Set active</button><button type="button" onClick={() => void archive(selectedProfile)} disabled={selectedProfile.isDefault}>Archive</button></>}<button className="danger" type="button" onClick={()=>{setDeleteTarget(selectedProfile);setDeleteConfirmation('')}} disabled={selectedProfile.isDefault}>Delete</button></div>}
      </aside>

      <div className="stack strategy-main" data-step={builderStep}>
        <div className="card builder-progress"><div className="mobile-step-summary"><strong>Step {BUILDER_STEPS.findIndex(([key])=>key===builderStep)+1} of {BUILDER_STEPS.length}</strong><span>{BUILDER_STEPS.find(([key])=>key===builderStep)?.[1]}</span><div><i style={{width:`${((BUILDER_STEPS.findIndex(([key])=>key===builderStep)+1)/BUILDER_STEPS.length)*100}%`}} /></div></div><div className="wizard-steps">{BUILDER_STEPS.map(([key,label],index)=><button type="button" key={key} className={builderStep===key?'active':''} onClick={()=>setBuilderStep(key)}><span>{index+1}</span>{label}</button>)}</div></div>
        <div className="card builder-section step-identity">
          <div className="conversation-prompt"><span aria-hidden="true">TP</span><div><p className="muted">LET'S START WITH YOUR APPROACH</p><h2>What do you call the way you trade?</h2><p>Teach me in your own terms. I’ll turn your answers into a playbook I can enforce consistently.</p></div>{profile.isDefault && <strong className="badge authorized">ACTIVE</strong>}</div>
          <div className="grid grid-2">
            <label>Strategy name<input value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} /></label>
            <label>Description<textarea value={profile.description ?? ''} onChange={(event) => setProfile({ ...profile, description: event.target.value })} /></label>
          </div>
        </div>

        <div className="card builder-section step-markets"><div className="conversation-prompt"><span aria-hidden="true">TP</span><div><h2>What do you trade?</h2><p>Choose every instrument that belongs to this playbook.</p></div></div><InstrumentSelector catalog={catalog} selected={profile.instruments} onChange={(instruments) => setProfile({ ...profile, instruments })} /></div>

        <div className="card builder-section step-timeframes"><div className="conversation-prompt"><span aria-hidden="true">TP</span><div><h2>How do you read price from context to entry?</h2><p>Teach me the five layers you use to move from the bigger picture to the trigger.</p></div></div><div className="grid grid-3">
          {([['macroTimeframe','Macro'],['trendTimeframe','Trend'],['confirmationTimeframe','Confirmation'],['entryTimeframe','Entry'],['triggerTimeframe','Trigger']] as [keyof StrategyProfile,string][]).map(([key,label]) => <label key={String(key)}>{label}<select value={String(profile[key] ?? '')} onChange={(event) => setProfile({ ...profile, [key]: event.target.value })}>{TIMEFRAMES.map((timeframe) => <option key={timeframe}>{timeframe}</option>)}</select></label>)}
        </div><p className="muted">All five configured layers are persisted and used by live analysis.</p></div>

        <div className="card builder-section step-schedule"><div className="conversation-prompt"><span aria-hidden="true">TP</span><div><h2>When are you willing to trade?</h2><p>Tell me the sessions and hours that belong to this strategy. I’ll translate them to your timezone.</p></div></div><SessionSelector sessions={sessions} onChange={setSessions} userTimezone={userTimezone} onUserTimezoneChange={updateUserTimezone} /></div>

        <div className="card builder-section step-risk"><div className="conversation-prompt"><span aria-hidden="true">TP</span><div><h2>How should I protect you when risk rises?</h2><p>Set the boundaries that must hold before I authorize a trade.</p></div></div><RiskSettings profile={profile} onChange={setProfile} /></div>

        <div className="card builder-section step-rules"><div className="conversation-prompt"><span aria-hidden="true">TP</span><div><h2>What must you see before taking the trade?</h2><p>Classify every rule by who supplies the evidence: Trade Police, you, or an external source.</p></div></div><StrategyPersonalization profile={profile} onChange={setProfile} /><hr/><h2>Your evidence rules</h2><p className="muted">Required rules override the score. Every enabled rule can be saved, regardless of its evidence source.</p><RuleBuilder rules={rules} onChange={setRules} /></div>

        <div className="card builder-section step-management"><h2>Stop-loss operating range by instrument</h2><p className="muted">Minimum prevents unrealistically tight stops, preferred defines your normal operating distance, and maximum is the hard ceiling.</p><StopLimitBuilder instruments={profile.instruments} limits={stopLimits} onChange={setStopLimits} /></div>

        <div className="card builder-section step-management"><h2>Preferred setups</h2><div className="chip-list">{SETUPS.map((setup) => { const active = profile.preferredSetups?.includes(setup); return <button type="button" className={`chip ${active ? 'selected' : ''}`} key={setup} onClick={() => setProfile({ ...profile, preferredSetups: active ? profile.preferredSetups?.filter((item) => item !== setup) : [...(profile.preferredSetups ?? []), setup] })}>{setup}</button>; })}</div><label className="check-row"><input type="checkbox" checked={Boolean(profile.rejectUnlistedSetups)} onChange={(event) => setProfile({ ...profile, rejectUnlistedSetups: event.target.checked })} /><span>Reject setups not selected above</span></label></div>

        <div className="card builder-section step-management"><h2>News protection</h2><label>Beta news rule<select value={profile.newsMode==='ALLOW'?'ALLOW':'ALL_HIGH_IMPACT'} onChange={(event) => setProfile({ ...profile, newsMode: event.target.value as StrategyProfile['newsMode'] })}><option value="ALL_HIGH_IMPACT">Block high-impact news conflicts</option><option value="ALLOW">Allow high-impact news conflicts</option></select></label><p className="muted">Currency filtering and before/after news windows are coming later.</p></div>


        <div className="card builder-section step-review"><p className="muted">FINAL REVIEW</p><h2>{profile.name || 'Untitled strategy'}</h2><div className="grid grid-3 metric-grid"><div className="card metric"><span className="muted">Markets</span><strong>{profile.instruments.length} instruments</strong></div><div className="card metric"><span className="muted">Sessions</span><strong>{sessions.length}</strong></div><div className="card metric"><span className="muted">Risk per trade</span><strong>{profile.maximumRiskPercent}%</strong></div><div className="card metric"><span className="muted">Minimum RR</span><strong>1:{profile.minimumRR}</strong></div><div className="card metric"><span className="muted">Authorization</span><strong>{profile.authorizationScore}</strong></div><div className="card metric"><span className="muted">Mandatory rules</span><strong>{rules.filter((rule) => rule.mandatory).length}</strong></div><div className="card metric"><span className="muted">Trading style</span><strong>{profile.tradingStyle ?? 'day-trading'}</strong></div><div className="card metric"><span className="muted">Methodology rules</span><strong>{(profile.strategyMethodologies ?? []).reduce((sum,item)=>sum+item.rules.length,0)}</strong></div></div><p className="muted">Review the settings above, then save. Existing open trades keep the strategy snapshot used at entry.</p></div>

        <div className="button-row sticky-actions"><button type="button" onClick={()=>{const index=BUILDER_STEPS.findIndex(([key])=>key===builderStep);if(index>0)setBuilderStep(BUILDER_STEPS[index-1][0]);}} disabled={builderStep==='identity'}>Back</button>{builderStep!=='review'?<button className="primary" type="button" onClick={()=>{const index=BUILDER_STEPS.findIndex(([key])=>key===builderStep);setBuilderStep(BUILDER_STEPS[Math.min(index+1,BUILDER_STEPS.length-1)][0]);}}>Continue</button>:<button className="primary" type="button" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save Strategy'}</button>}<a className="button-link" href="/validate">Validation Desk</a></div>
        {message && <p className={message==='Saved' || message.includes('active strategy') ? 'success' : 'warning'}>{message}</p>}
      </div>
      {deleteTarget&&<div className="modal-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget){setDeleteTarget(null);setDeleteConfirmation('')}}}><section className="card modal-card playbook-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-playbook-title"><div className="modal-head"><div><p className="muted">PERMANENT ACTION</p><h2 id="delete-playbook-title">Delete {deleteTarget.name}?</h2></div><button type="button" aria-label="Close delete dialog" onClick={()=>{setDeleteTarget(null);setDeleteConfirmation('')}}>×</button></div><p>This removes the playbook and its editable configuration. Historical trade analyses, strategy snapshots, and recorded strategy names will be preserved; their live playbook reference will be detached.</p><label>Type <strong>DELETE</strong> to confirm<input autoFocus value={deleteConfirmation} onChange={event=>setDeleteConfirmation(event.target.value)} /></label><div className="button-row"><button type="button" onClick={()=>{setDeleteTarget(null);setDeleteConfirmation('')}}>Cancel</button><button className="danger" type="button" disabled={deleteConfirmation!=='DELETE'||saving} onClick={()=>void deletePlaybook()}>{saving?'Deleting…':'Delete playbook permanently'}</button></div></section></div>}
    </div>
  );
}
