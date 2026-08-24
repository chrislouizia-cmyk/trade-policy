'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import InstrumentSelector, { CatalogInstrument } from '@/components/InstrumentSelector';
import SessionSelector, { PRESET_SESSIONS } from '@/components/SessionSelector';
import { DEFAULT_RULES } from '@/components/RuleBuilder';
import RuleComposer from '@/components/RuleComposer';
import RiskSettings from '@/components/RiskSettings';
import StopLimitBuilder from '@/components/StopLimitBuilder';
import StrategyPersonalization from '@/components/StrategyPersonalization';
import StrategyLearningConfirmation from '@/components/StrategyLearningConfirmation';
import MethodologyVerification from '@/components/MethodologyVerification';
import StrategyBuilderV2 from '@/components/StrategyBuilderV2';
import StrategyDetailPage from '@/components/StrategyDetailPage';
import { DEFAULT_STRATEGY_PROFILE } from '@/types/trade';
import type { EvidenceKey, StopLimit, StrategyProfile, StrategyRule, StrategySession } from '@/types/trade';
import { deriveRequiredEvidence, normalizeStrategyProfile } from '@/lib/strategy-policy';
import { resolveBuilderEntryMode } from '@/lib/strategy-builder-entry';
import { apiErrorMessage } from '@/lib/api-error';
import { trackBetaEvent, trackBetaEventOnce } from '@/lib/beta-intelligence';
import { buildFinalReviewSummary } from '@/lib/final-review-summary';
import { buildPayloadInstruments, buildPayloadStopLimits, createNewStrategyDraft, createStarterStrategyDraft, createStarterTemplateSelection, hydrateDraftFromSavedProfile, deriveStopLimitsForInstruments } from '@/lib/strategy-builder-draft';
import { persistedStrategyToV2State, v2StateToPersistedStrategy, type StrategyBuilderV2State, type V2Persisted } from '@/lib/strategy-builder-v2-persistence';
import { validateStrategyName } from '@/lib/strategy-name';
import { isStrategyDirty } from '@/lib/strategy-dirty-state';

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

function createEmptyStrategyProfile(): StrategyProfile {
  const next = cloneDefault();
  next.id = undefined;
  next.name = 'New Strategy';
  next.instruments = [];
  next.instrumentTradeLimits = {};
  next.stopLimits = {};
  next.stopLimitSettings = [];
  return next;
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

export default function StrategyBuilder({ userId, planCode = 'FREE' }: { userId: string; planCode?: string }) {
  const searchParams = useSearchParams();
  const [profiles, setProfiles] = useState<StrategyProfile[]>([]);
  const [profile, setProfile] = useState<StrategyProfile>(createEmptyStrategyProfile);
  const [catalog, setCatalog] = useState<CatalogInstrument[]>(FALLBACK_CATALOG);
  const [sessions, setSessions] = useState<StrategySession[]>(PRESET_SESSIONS.filter((item) => ['LONDON','NEW_YORK'].includes(item.sessionCode)));
  const [rules, setRules] = useState<StrategyRule[]>(DEFAULT_RULES);
  const [stopLimits, setStopLimits] = useState<StopLimit[]>([]);
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
  const [v2EntryOpen, setV2EntryOpen] = useState(false);
  const [v2EntryMode,setV2EntryMode]=useState<'CREATE'|'EDIT'>('CREATE');
  const [v2State, setV2State] = useState<StrategyBuilderV2State|undefined>();
  const [savedStrategy, setSavedStrategy] = useState<{id:string;name:string;isDefault:boolean}|null>(null);
  const [v2Baseline,setV2Baseline]=useState<StrategyBuilderV2State|null>(null);
  const [v2Draft,setV2Draft]=useState<StrategyBuilderV2State|null>(null);
  const [pendingNavigation,setPendingNavigation]=useState<null|(()=>void)>(null);
  const [dirtyPrompt,setDirtyPrompt]=useState(false);
  const [strategyRuns, setStrategyRuns] = useState<any[]>([]);
  const finalReview=useMemo(()=>buildFinalReviewSummary(profile,rules,sessions),[profile,rules,sessions]);
  const finalReviewNameError=validateStrategyName(profile.name);
  const quickstartRequested = searchParams.get('quickstart') === '1';
  const selectedStrategyId = searchParams.get('strategy');
  const requestedMode = searchParams.get('mode');

  useEffect(() => {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Monterrey';
    const saved = window.localStorage.getItem('trade-police-timezone');
    setUserTimezone(saved || detected);
    void loadAll();
    void trackBetaEventOnce('ONBOARDING_STARTED');
  }, [userId]);

  useEffect(() => {
    if (!profile.id || !userId) {
      setStrategyRuns([]);
      return;
    }

    const supabase = createClient();
    void supabase
      .from('backtest_runs')
      .select('*')
      .eq('user_id', userId)
      .eq('strategy_profile_id', profile.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setStrategyRuns(data ?? []));
  }, [profile.id, userId]);

  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem('trade-police-strategy-draft', JSON.stringify({ profile, sessions, rules, stopLimits }));
  }, [profile, sessions, rules, stopLimits]);

  useEffect(() => {
    if (!quickstartRequested || loading) return;
    setMessage('Starter template includes XAUUSD. Review the template and choose Use starter rules to apply it explicitly.');
    if (typeof window !== 'undefined') {
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.delete('quickstart');
      window.history.replaceState({}, '', `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
    }
  }, [quickstartRequested, loading]);

  useEffect(() => {
    if (!selectedStrategyId || !profiles.length) return;
    const target = profiles.find((item) => item.id === selectedStrategyId);
    if (!target) return;

    const resolveRequestedAction = () => {
      if (requestedMode === 'duplicate') {
        void duplicate(target);
        return;
      }

      if (requestedMode === 'edit') {
        if (v2Baseline && v2Draft && isStrategyDirty(v2Baseline, v2Draft)) {
          setPendingNavigation(() => () => {
            void openProfile(target);
            if (target.personalRules?.some((rule) => rule.key === 'trade-police-v2-metadata')) {
              openV2Edit();
            } else {
              setBuilderStep('identity');
            }
          });
          setDirtyPrompt(true);
          return;
        }

        void openProfile(target);
        if (target.personalRules?.some((rule) => rule.key === 'trade-police-v2-metadata')) {
          openV2Edit();
        } else {
          setBuilderStep('identity');
        }
        return;
      }

      void openProfile(target);
    };

    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.delete('strategy');
    nextUrl.searchParams.delete('mode');
    window.history.replaceState({}, '', `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
    resolveRequestedAction();
  }, [profiles, selectedStrategyId, requestedMode, v2Baseline, v2Draft]);

  useEffect(() => {
    setStopLimits((current) => deriveStopLimitsForInstruments(profile.instruments, current));
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

    if (target) {
      await openProfile(target);
    } else {
      setV2EntryOpen(false);
      setBuilderStep('identity');
      setProfile(createEmptyStrategyProfile());
      setSessions(PRESET_SESSIONS.filter((item) => ['LONDON','NEW_YORK'].includes(item.sessionCode)));
      setRules(DEFAULT_RULES);
      setStopLimits([]);
      setMessage('No saved strategies yet. Create a new strategy to begin.');
    }
    setLoading(false);
  }

  async function openProfile(target: StrategyProfile) {
    setProfile(target);
    setV2EntryOpen(false);
    if (!target.id) return;
    const supabase = createClient();
    const [{ data: sessionRows }, { data: ruleRows }, { data: stopRows }, { data: instrumentRows }] = await Promise.all([
      supabase.from('strategy_sessions').select('*').eq('strategy_id', target.id).order('created_at'),
      supabase.from('strategy_rules').select('*').eq('strategy_id', target.id).order('sort_order'),
      supabase.from('strategy_stop_limits').select('*').eq('strategy_id', target.id),
      supabase.from('strategy_instruments').select('*').eq('strategy_id', target.id).eq('enabled', true).order('sort_order'),
    ]);

    const savedInstruments = instrumentRows?.length ? instrumentRows.map((row: any) => row.symbol) : target.instruments;
    const hydrated = hydrateDraftFromSavedProfile({
      id: target.id,
      name: target.name,
      description: target.description ?? '',
      isDefault: target.isDefault,
      instruments: savedInstruments,
    }, stopRows?.length ? stopRows.map((row: any) => ({ instrument: row.instrument, method: row.method, minimumValue: Number(row.minimum_value ?? 0), preferredValue: Number(row.preferred_value ?? row.maximum_value), maximumValue: Number(row.maximum_value), atrMultiplier: row.atr_multiplier === null ? undefined : Number(row.atr_multiplier) })) : []);
    setProfile({ ...target, instruments: hydrated.profile.instruments });
    setSessions(sessionRows?.length ? sessionRows.map((row: any) => ({ id: row.id, sessionCode: row.session_code, name: row.name, timezone: row.timezone, startTime: row.start_time.slice(0,5), endTime: row.end_time.slice(0,5), days: row.days, allowOpenOutside: row.allow_open_outside, allowHoldOutside: row.allow_hold_outside, isCustom: row.is_custom })) : PRESET_SESSIONS.filter((item) => target.allowedSessions.includes(item.sessionCode)));
    setRules(ruleRows?.length ? ruleRows.map((row: any) => ({ ruleKey: row.rule_key, label: row.label, enabled: row.enabled, mandatory: row.mandatory, weight: Number(row.weight), minimumConfidence: row.minimum_confidence, timeframeRole: row.timeframe_role, evaluationMode:row.evaluation_mode??'AUTOMATIC' })) : DEFAULT_RULES.map((rule) => ({ ...rule, mandatory: target.requiredEvidence.includes(rule.ruleKey as EvidenceKey), weight: target.evidenceWeights[rule.ruleKey as EvidenceKey] ?? rule.weight })));
    setStopLimits(hydrated.stopLimits);
    setMessage('');
  }
  function requestOpenProfile(target: StrategyProfile) { if(v2Baseline&&v2Draft&&isStrategyDirty(v2Baseline,v2Draft)){setPendingNavigation(()=>()=>{void openProfile(target)});setDirtyPrompt(true);return;} void openProfile(target); }

  function startNew() {
    if(v2Baseline&&v2Draft&&isStrategyDirty(v2Baseline,v2Draft)){setPendingNavigation(()=>()=>startNewNow());setDirtyPrompt(true);return;} startNewNow();
  }
  function startNewNow() {
    const draft = createNewStrategyDraft();
    const next = cloneDefault();
    next.id = undefined;
    next.name = draft.profile.name;
    next.isDefault = profiles.length === 0;
    next.instruments = draft.profile.instruments;
    setProfile(next);
    setSessions([]);
    setRules([]);
    setStopLimits([]);
    setV2State(undefined);
    setV2Baseline(null);setV2Draft(null);
    setV2EntryMode('CREATE');
    if (typeof window !== 'undefined') window.localStorage.removeItem('trade-police-strategy-draft');
    setV2EntryOpen(true);
    setBuilderStep('identity');
    setMessage('Choose a creation mode to start your new strategy.');
  }
  function openV2Edit(){
    if(!profile.id)return;
    const hydrated=persistedStrategyToV2State(profile,rules,sessions);
    setV2State(hydrated);setV2Baseline(hydrated);setV2Draft(hydrated);setV2EntryMode('EDIT');setV2EntryOpen(true);setMessage('');
  }

  function useStarterRules(confirmed = false){
    const selection = createStarterTemplateSelection();
    if (!confirmed) {
      const shouldApply = typeof window !== 'undefined' ? window.confirm(`This starter template includes: ${selection.instruments.join(', ')}. Apply it now?`) : true;
      if (!shouldApply) {
        setMessage('Starter template not applied. You can continue building from scratch.');
        return;
      }
    }
    const draft = createStarterStrategyDraft();
    const next=cloneDefault();
    next.id=undefined;next.name=draft.profile.name;next.description=draft.profile.description;next.isDefault=true;next.instruments=selection.instruments;next.instrumentTradeLimits={};
    setProfile(next);setSessions(PRESET_SESSIONS.filter(item=>['LONDON','NEW_YORK'].includes(item.sessionCode)));setRules(DEFAULT_RULES);setStopLimits([]);setBuilderStep('review');setMessage('Starter rules loaded for review. Nothing is active until you save and confirm them.');
  }

  function handleV2Apply(persisted: V2Persisted) {
    setProfile(persisted.profile);
    setRules(persisted.rules);
    setSessions(persisted.sessions);
    setStopLimits(persisted.profile.stopLimitSettings ?? []);
    setV2State(persistedStrategyToV2State(persisted.profile, persisted.rules, persisted.sessions));
    setV2EntryOpen(false);
    setBuilderStep('review');
  }

  async function save(persistedOverride?:V2Persisted):Promise<boolean> {
    const saveProfile=persistedOverride?.profile??profile, saveRules=persistedOverride?.rules??rules, saveSessions=persistedOverride?.sessions??sessions, saveStops=persistedOverride?.profile.stopLimitSettings??stopLimits;
    const nameError=validateStrategyName(saveProfile.name); if (nameError) {setMessage(nameError);return false;}
    if (saveProfile.instruments.length === 0) {setMessage('Select at least one instrument.');return false;}
    if (saveProfile.waitScore >= saveProfile.authorizationScore) {setMessage('WAIT score must be lower than AUTHORIZED score.');return false;}
    const updatingExisting=Boolean(saveProfile.id);
    setSaving(true);
    setMessage('');
    try {
    const enabledRules = saveRules.filter((rule) => rule.enabled);
    const evidenceWeights = { ...saveProfile.evidenceWeights };
    enabledRules.forEach((rule) => {
      if (rule.ruleKey in evidenceWeights) evidenceWeights[rule.ruleKey as EvidenceKey] = rule.weight;
    });
    const requiredEvidence = deriveRequiredEvidence(enabledRules, evidenceWeights);
    if (!requiredEvidence.length) {
      setMessage('Strategy setup required: add at least one enabled, supported, mandatory rule before saving or activating this playbook.');
      return false;
    }
    const legacyStopLimits = { ...saveProfile.stopLimits };
    saveStops.forEach((limit) => { legacyStopLimits[limit.instrument] = limit.maximumValue; });

    const normalized=normalizeStrategyProfile(saveProfile);
    const row = {
      engine_version:2,
      name: saveProfile.name.trim(), description: saveProfile.description ?? '', is_default: Boolean(saveProfile.isDefault),
      is_archived: false,
      market_types: saveProfile.marketTypes ?? ['FOREX'],
      instruments: saveProfile.instruments,
      macro_timeframe: saveProfile.macroTimeframe, trend_timeframe: saveProfile.trendTimeframe, confirmation_timeframe: saveProfile.confirmationTimeframe, entry_timeframe: saveProfile.entryTimeframe, trigger_timeframe: saveProfile.triggerTimeframe, minimum_rr: saveProfile.minimumRR, preferred_rr: saveProfile.preferredRR, maximum_risk_percent: saveProfile.maximumRiskPercent,
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
      allowed_sessions: saveSessions.map((item) => item.sessionCode),
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
      strategyId:saveProfile.id??null,activate:Boolean(saveProfile.isDefault),profile:row,
      instruments:buildPayloadInstruments(saveProfile.instruments), sessions:saveSessions.map(session=>({session_code:session.sessionCode,name:session.name,timezone:session.timezone,start_time:session.startTime,end_time:session.endTime,days:session.days,allow_open_outside:session.allowOpenOutside,allow_hold_outside:session.allowHoldOutside,is_custom:Boolean(session.isCustom)})), rules:saveRules.map((rule,index)=>({rule_key:rule.ruleKey,label:rule.label,enabled:rule.enabled,mandatory:rule.mandatory,weight:rule.weight,minimum_confidence:rule.minimumConfidence,timeframe_role:rule.timeframeRole,evaluation_mode:rule.evaluationMode??'AUTOMATIC',sort_order:index})),stopLimits:buildPayloadStopLimits(saveProfile.instruments, saveStops),
    })});
    const result=await response.json();
    if(!response.ok)throw new Error(apiErrorMessage(result,'Could not save strategy.'));
    if(!result.strategyId||result.saved!==true||!result.strategy||result.strategy.id!==result.strategyId||typeof result.strategy.name!=='string'||!result.strategy.name.trim())throw new Error('Strategy persistence response was incomplete.');
    const savedProfile:StrategyProfile={...normalized,...saveProfile,id:result.strategyId,allowedSessions:saveSessions.map(item=>item.sessionCode),requiredEvidence,evidenceWeights,rules:[...saveRules],stopLimits:legacyStopLimits,stopLimitSettings:[...saveStops]};
    await loadAll(result.strategyId);
    setSavedStrategy({id:result.strategy.id,name:result.strategy.name,isDefault:Boolean(result.strategy.is_default)}); setMessage(`Strategy saved — ${result.strategy.name}`);
    if(refinementRequested){setVerification({profile:savedProfile,rules:[...saveRules]});setLearningConfirmation(null);setRefinementRequested(false)}
    else setLearningConfirmation({profile:savedProfile,rules:[...saveRules]});
    void trackBetaEvent(updatingExisting?'PLAYBOOK_UPDATED':'PLAYBOOK_CREATED',result.strategyId);void trackBetaEvent('STRATEGY_SAVED',result.strategyId);
    window.dispatchEvent(new CustomEvent('trade-police:strategy-changed',{detail:{strategyId:result.strategyId}}));return true;
    } catch (error) {
      setMessage(error instanceof Error&&error.message.startsWith('Could not save strategy:')?error.message:`Could not save strategy: ${error instanceof Error?error.message:'Unknown persistence error.'}`);return false;
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

  if (loading) return <div className="strategy-builder-skeleton" aria-live="polite" aria-busy="true"><span className="sr-only">Loading Strategy Builder.</span><div className="card skeleton-panel"><i className="skeleton-block"/><i className="skeleton-block"/><i className="skeleton-block"/></div><div className="card skeleton-panel skeleton-panel-wide"><i className="skeleton-block"/><i className="skeleton-block"/><i className="skeleton-block"/><i className="skeleton-block"/></div></div>;
  if (verification) return <MethodologyVerification profile={verification.profile} rules={verification.rules} onAccept={()=>{void trackBetaEvent('SIMULATION_APPROVED',verification.profile.id);void trackBetaEvent('ONBOARDING_COMPLETED',verification.profile.id);window.localStorage.setItem(`trade-police-methodology-confirmed:${verification.profile.id??'current'}`,'true');window.location.assign('/validate')}} onRefine={()=>{void trackBetaEvent('SIMULATION_REJECTED',verification.profile.id);void trackBetaEvent('METHODOLOGY_REJECTED',verification.profile.id);setVerification(null);setLearningConfirmation(null);setRefinementRequested(true);setBuilderStep('rules');setMessage('What did I miss? Update the rules, confirmations, thresholds, or any playbook setting, then save to verify again.')}}/>;
  if (learningConfirmation) return <><section className="card strategy-save-success" aria-live="polite"><strong>Strategy saved — {savedStrategy?.name??learningConfirmation.profile.name}</strong><p>{savedStrategy?.isDefault?'Active strategy':'Saved strategy — not active.'}</p><button type="button" onClick={()=>{setLearningConfirmation(null);void loadAll(savedStrategy?.id)}}>View strategy</button></section><StrategyLearningConfirmation profile={learningConfirmation.profile} rules={learningConfirmation.rules} onEdit={()=>{void trackBetaEvent('METHODOLOGY_REJECTED',learningConfirmation.profile.id);setLearningConfirmation(null);setBuilderStep('identity')}} onConfirm={()=>{void trackBetaEvent('METHODOLOGY_CONFIRMED',learningConfirmation.profile.id);setVerification(learningConfirmation);setLearningConfirmation(null)}}/></>;
  if (v2EntryOpen) {
    return <><StrategyBuilderV2 key={`${v2EntryMode}:${profile.id??'new'}`} profile={profile} initialState={v2State} mode={v2EntryMode} onApply={handleV2Apply} onStateChange={(state)=>{setV2Draft(state);setV2Baseline(current=>current??state)}} onCancel={() => { if(v2Baseline&&v2Draft&&isStrategyDirty(v2Baseline,v2Draft)){setPendingNavigation(()=>()=>{setV2EntryOpen(false);setBuilderStep('identity')});setDirtyPrompt(true);return;} setV2EntryOpen(false); setBuilderStep('identity'); }} />{dirtyPrompt&&<div className="full-report-overlay" role="dialog" aria-modal="true"><section className="full-report-modal"><header className="full-report-header"><h2>Unsaved changes</h2></header><div className="full-report-body"><p>Save or discard your strategy edits before leaving.</p><div className="button-row"><button className="primary" disabled={saving} onClick={()=>{const draft=v2Draft;if(!draft)return;void save(v2StateToPersistedStrategy(profile,draft)).then(saved=>{if(!saved)return;setV2Baseline(draft);const next=pendingNavigation;setDirtyPrompt(false);setPendingNavigation(null);next?.();});}}> {saving?'Saving…':'Save changes'}</button><button onClick={()=>{setV2Draft(v2Baseline);setV2State(v2Baseline??undefined);const next=pendingNavigation;setDirtyPrompt(false);setPendingNavigation(null);next?.()}}>Discard changes</button><button onClick={()=>{setDirtyPrompt(false);setPendingNavigation(null)}}>Cancel</button></div></div></section></div>}</>;
  }

  if (selectedProfile) {
    return (
      <div className="strategy-builder-layout">
        <aside className="card strategy-sidebar">
          <div className="sidebar-head"><div><p className="muted">STRATEGIES</p><h2>My Strategies</h2></div><button type="button" onClick={startNew}>Create New Strategy</button></div>
          <div className="strategy-list">
            {activeProfiles.map((item) => (
              <button type="button" key={item.id} className={`strategy-list-item ${item.id === profile.id ? 'selected' : ''}`} onClick={() => requestOpenProfile(item)}>
                <span>{item.isDefault ? '●' : '○'}</span><div><strong>{item.name}</strong><small>{item.isDefault ? 'ACTIVE' : `${item.instruments.length} instruments`}</small></div>
              </button>
            ))}
            {archivedProfiles.length>0&&<><p className="muted strategy-list-label">ARCHIVED</p>{archivedProfiles.map((item) => (
              <button type="button" key={item.id} className={`strategy-list-item archived ${item.id === profile.id ? 'selected' : ''}`} onClick={() => requestOpenProfile(item)}>
                <span>◇</span><div><strong>{item.name}</strong><small>ARCHIVED · {item.instruments.length} instruments</small></div>
              </button>
            ))}</>}
          </div>
          {selectedProfile && <div className="stack sidebar-actions"><button type="button" onClick={()=>{if(profile.personalRules?.some(rule=>rule.key==='trade-police-v2-metadata'))openV2Edit();else setBuilderStep('identity')}}>Edit</button><button type="button" onClick={() => void duplicate(selectedProfile)}>Duplicate</button>{selectedProfile.isArchived?<button type="button" onClick={() => void restore(selectedProfile)}>Restore</button>:<><button type="button" onClick={() => void setActive(selectedProfile)} disabled={selectedProfile.isDefault}>Set active</button><button type="button" onClick={() => void archive(selectedProfile)} disabled={selectedProfile.isDefault}>Archive</button></>}<button className="danger" type="button" onClick={()=>{setDeleteTarget(selectedProfile);setDeleteConfirmation('')}} disabled={selectedProfile.isDefault}>Delete</button></div>}
        </aside>

        <div className="stack strategy-main" data-step={builderStep}>
          <StrategyDetailPage
            strategy={{
              id: selectedProfile.id ?? '',
              name: selectedProfile.name,
              description: selectedProfile.description ?? '',
              market_types: selectedProfile.marketTypes ?? ['FOREX'],
              instruments: selectedProfile.instruments ?? [],
              macro_timeframe: selectedProfile.macroTimeframe ?? null,
              trend_timeframe: selectedProfile.trendTimeframe ?? null,
              confirmation_timeframe: selectedProfile.confirmationTimeframe ?? null,
              entry_timeframe: selectedProfile.entryTimeframe ?? null,
              trigger_timeframe: selectedProfile.triggerTimeframe ?? null,
              maximum_risk_percent: selectedProfile.maximumRiskPercent ?? null,
              minimum_rr: selectedProfile.minimumRR ?? null,
              authorization_score: selectedProfile.authorizationScore ?? null,
              wait_score: selectedProfile.waitScore ?? null,
              created_at: null,
              updated_at: null,
              is_default: selectedProfile.isDefault ?? false,
              allowed_sessions: selectedProfile.allowedSessions ?? [],
              required_evidence: selectedProfile.requiredEvidence ?? [],
              stop_limits: selectedProfile.stopLimits ?? {},
            }}
            rules={rules.map((rule) => ({ ...rule, id: rule.ruleKey ?? rule.label ?? undefined }))}
            sessions={sessions.map((session) => ({ ...session, id: session.id ?? session.sessionCode }))}
            initialRuns={strategyRuns}
            planCode={planCode}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="strategy-builder-layout">
      <aside className="card strategy-sidebar">
        <div className="sidebar-head"><div><p className="muted">STRATEGIES</p><h2>My Strategies</h2></div><button type="button" onClick={startNew}>Create New Strategy</button></div>
        <div className="strategy-list">
          {activeProfiles.map((item) => (
            <button type="button" key={item.id} className={`strategy-list-item ${item.id === profile.id ? 'selected' : ''}`} onClick={() => void openProfile(item)}>
              <span>{item.isDefault ? '●' : '○'}</span><div><strong>{item.name}</strong><small>{item.isDefault ? 'ACTIVE' : `${item.instruments.length} instruments`}</small></div>
            </button>
          ))}
          {archivedProfiles.length>0&&<><p className="muted strategy-list-label">ARCHIVED</p>{archivedProfiles.map((item) => (
            <button type="button" key={item.id} className={`strategy-list-item archived ${item.id === profile.id ? 'selected' : ''}`} onClick={() => void openProfile(item)}>
              <span>◇</span><div><strong>{item.name}</strong><small>ARCHIVED · {item.instruments.length} instruments</small></div>
            </button>
          ))}</>}
        </div>
      </aside>

      <div className="stack strategy-main" data-step={builderStep}>
        {activeProfiles.length===0&&<section className="card quick-start-card"><p className="eyebrow">MY STRATEGIES</p><h2>No saved strategies yet</h2><p>Start a strategy from a guided setup or create a blank playbook. The method you choose determines the flow and review steps.</p><div className="button-row"><button className="primary" type="button" onClick={startNew}>Create New Strategy</button><button type="button" onClick={() => useStarterRules()}>Use starter rules</button></div></section>}
        <div className="card builder-progress"><div className="mobile-step-summary"><strong>Step {BUILDER_STEPS.findIndex(([key])=>key===builderStep)+1} of {BUILDER_STEPS.length}</strong><span>{BUILDER_STEPS.find(([key])=>key===builderStep)?.[1]}</span><div><i style={{width:`${((BUILDER_STEPS.findIndex(([key])=>key===builderStep)+1)/BUILDER_STEPS.length)*100}%`}} /></div></div><div className="wizard-steps">{BUILDER_STEPS.map(([key,label],index)=><button type="button" key={key} className={builderStep===key?'active':''} onClick={()=>setBuilderStep(key)}><span>{index+1}</span>{label}</button>)}</div></div>
        <div className="card builder-section step-identity">
          <div className="conversation-prompt"><span aria-hidden="true">TP</span><div><p className="muted">LET'S START WITH YOUR APPROACH</p><h2>What do you call the way you trade?</h2><p>Describe it in your own terms. I’ll turn your answers into rules I can check consistently.</p></div>{profile.isDefault && <strong className="badge authorized">ACTIVE</strong>}</div>
          <div className="grid grid-2">
            <label>Strategy name<input value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} /></label>
            <label>Description<textarea value={profile.description ?? ''} onChange={(event) => setProfile({ ...profile, description: event.target.value })} /></label>
          </div>
        </div>

        <div className="card builder-section step-markets"><div className="conversation-prompt"><span aria-hidden="true">TP</span><div><h2>What do you trade?</h2><p>Choose every instrument that belongs to this strategy.</p></div></div><InstrumentSelector catalog={catalog} selected={profile.instruments} onChange={(instruments) => setProfile({ ...profile, instruments })} /></div>

        <div className="card builder-section step-timeframes"><div className="conversation-prompt"><span aria-hidden="true">TP</span><div><h2>How do you read price from context to entry?</h2><p>Teach me the five layers you use to move from the bigger picture to the trigger.</p></div></div><div className="grid grid-3">
          {([['macroTimeframe','Macro'],['trendTimeframe','Trend'],['confirmationTimeframe','Confirmation'],['entryTimeframe','Entry'],['triggerTimeframe','Trigger']] as [keyof StrategyProfile,string][]).map(([key,label]) => <label key={String(key)}>{label}<select value={String(profile[key] ?? '')} onChange={(event) => setProfile({ ...profile, [key]: event.target.value })}>{TIMEFRAMES.map((timeframe) => <option key={timeframe}>{timeframe}</option>)}</select></label>)}
        </div><p className="muted">All five configured layers are persisted and used by live analysis.</p></div>

        <div className="card builder-section step-schedule"><div className="conversation-prompt"><span aria-hidden="true">TP</span><div><h2>When are you willing to trade?</h2><p>Tell me the sessions and hours that belong to this strategy. I’ll translate them to your timezone.</p></div></div><SessionSelector sessions={sessions} onChange={setSessions} userTimezone={userTimezone} onUserTimezoneChange={updateUserTimezone} /></div>

        <div className="card builder-section step-risk"><div className="conversation-prompt"><span aria-hidden="true">TP</span><div><h2>How should I protect you when risk rises?</h2><p>Set the boundaries that must hold before I authorize a trade.</p></div></div><RiskSettings profile={profile} onChange={setProfile} /></div>

        <div className="card builder-section step-rules"><div className="conversation-prompt"><span aria-hidden="true">TP</span><div><h2>What must you see before taking the trade?</h2><p>Choose what Trade Police can check, what you must confirm, and what cannot be verified here.</p></div></div><StrategyPersonalization profile={profile} onChange={setProfile} /><RuleComposer key={profile.id??'new'} rules={rules} onChange={setRules}/></div>

        <div className="card builder-section step-management"><h2>Stop-loss operating range by instrument</h2><p className="muted">Minimum prevents unrealistically tight stops, preferred defines your normal operating distance, and maximum is the hard ceiling.</p><StopLimitBuilder instruments={profile.instruments} limits={stopLimits} onChange={setStopLimits} /></div>

        <div className="card builder-section step-management"><h2>Preferred setups</h2><div className="chip-list">{SETUPS.map((setup) => { const active = profile.preferredSetups?.includes(setup); return <button type="button" className={`chip ${active ? 'selected' : ''}`} key={setup} onClick={() => setProfile({ ...profile, preferredSetups: active ? profile.preferredSetups?.filter((item) => item !== setup) : [...(profile.preferredSetups ?? []), setup] })}>{setup}</button>; })}</div><label className="check-row"><input type="checkbox" checked={Boolean(profile.rejectUnlistedSetups)} onChange={(event) => setProfile({ ...profile, rejectUnlistedSetups: event.target.checked })} /><span>Reject setups not selected above</span></label></div>

        <div className="card builder-section step-management"><h2>News protection</h2><label>Beta news rule<select value={profile.newsMode==='ALLOW'?'ALLOW':'ALL_HIGH_IMPACT'} onChange={(event) => setProfile({ ...profile, newsMode: event.target.value as StrategyProfile['newsMode'] })}><option value="ALL_HIGH_IMPACT">Block high-impact news conflicts</option><option value="ALLOW">Allow high-impact news conflicts</option></select></label><p className="muted">Currency filtering and before/after news windows are coming later.</p></div>


        <div className="card builder-section step-review"><p className="muted">FINAL REVIEW</p><h2>{profile.name || 'Untitled strategy'}</h2><label>Strategy name<input value={profile.name} onChange={event=>setProfile({...profile,name:event.target.value})} placeholder="Name this strategy" aria-invalid={Boolean(finalReviewNameError)} /></label>{finalReviewNameError&&<p className="warning">{finalReviewNameError}</p>}<section className="final-review-narrative"><h3>Here&apos;s what Trade Police will check</h3>{finalReview.narrative.map(line=><p key={line}>{line}</p>)}</section><div className="grid grid-3 metric-grid"><div className="card metric"><span className="muted">Markets</span><strong>{finalReview.instrumentLabel}</strong></div><div className="card metric"><span className="muted">Sessions</span><strong>{finalReview.sessionLabel}</strong></div><div className="card metric"><span className="muted">Risk</span><strong>{profile.maximumRiskPercent}% per trade</strong></div><div className="card metric"><span className="muted">Minimum RR</span><strong>1 : {profile.minimumRR}</strong></div><div className="card metric"><span className="muted">Required readiness</span><strong>{profile.authorizationScore}%</strong><small>The evidence readiness required before Trade Police can approve a trade.</small></div><div className="card metric"><span className="muted">Trading Style</span><strong>{finalReview.tradingStyle}</strong></div><div className="card metric trading-dna-review"><span className="muted">Trading rules</span><strong>{finalReview.totalRules} rules configured</strong><small>{finalReview.automaticRules} checked by Trade Police</small><small>{finalReview.manualRules} confirmed by you</small><small>{finalReview.externalRules} cannot be verified here</small></div></div><aside className="final-review-status"><span className="muted">Status</span><strong>✓ Rules captured</strong><strong>✓ {finalReview.readiness}</strong></aside><p className="muted">Review the settings above, then save the strategy. Existing open trades keep the exact rules used at entry.</p></div>

        <div className="button-row sticky-actions"><button type="button" onClick={()=>{const index=BUILDER_STEPS.findIndex(([key])=>key===builderStep);if(index>0)setBuilderStep(BUILDER_STEPS[index-1][0]);}} disabled={builderStep==='identity'}>Back</button>{builderStep!=='review'?<button className="primary" type="button" onClick={()=>{const index=BUILDER_STEPS.findIndex(([key])=>key===builderStep);setBuilderStep(BUILDER_STEPS[Math.min(index+1,BUILDER_STEPS.length-1)][0]);}}>Continue</button>:<button className="primary" type="button" onClick={() => void save()} disabled={saving||Boolean(finalReviewNameError)}>{saving ? 'Saving…' : 'Save strategy'}</button>}<a className="button-link" href="/validate">Check a setup</a></div>
        {message && <p className={message==='Saved' || message.includes('active strategy') ? 'success' : 'warning'}>{message}</p>}
      </div>
      {deleteTarget&&<div className="modal-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget){setDeleteTarget(null);setDeleteConfirmation('')}}}><section className="card modal-card playbook-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-playbook-title"><div className="modal-head"><div><p className="muted">PERMANENT ACTION</p><h2 id="delete-playbook-title">Delete {deleteTarget.name}?</h2></div><button type="button" aria-label="Close delete dialog" onClick={()=>{setDeleteTarget(null);setDeleteConfirmation('')}}>×</button></div><p>This removes the playbook and its editable configuration. Historical trade analyses, strategy snapshots, and recorded strategy names will be preserved; their live playbook reference will be detached.</p><label>Type <strong>DELETE</strong> to confirm<input autoFocus value={deleteConfirmation} onChange={event=>setDeleteConfirmation(event.target.value)} /></label><div className="button-row"><button type="button" onClick={()=>{setDeleteTarget(null);setDeleteConfirmation('')}}>Cancel</button><button className="danger" type="button" disabled={deleteConfirmation!=='DELETE'||saving} onClick={()=>void deletePlaybook()}>{saving?'Deleting…':'Delete playbook permanently'}</button></div></section></div>}
    </div>
  );
}
