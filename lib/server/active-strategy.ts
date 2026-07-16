import 'server-only';

import type { EvidenceKey, StopLimit, StrategyProfile, StrategyRule, StrategySession } from '@/types/trade';
import { normalizeStrategyPolicy } from '@/lib/strategy-policy';

type SupabaseServerClient = any;

export class NoActiveStrategyError extends Error {
  constructor() {
    super('No active strategy is configured. Complete strategy onboarding before analyzing a trade.');
    this.name = 'NoActiveStrategyError';
  }
}

export class StrategyNotFoundError extends Error {
  constructor() {
    super('The strategy stored on this trade could not be found.');
    this.name = 'StrategyNotFoundError';
  }
}

const evidenceKeys: EvidenceKey[] = [
  'h4TrendAligned',
  'h1TrendAligned',
  'structurePattern',
  'liquiditySweep',
  'chochConfirmed',
  'bosConfirmed',
  'orderBlock',
  'fairValueGap',
  'retestConfirmed',
];

export async function loadActiveStrategy(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<StrategyProfile> {
  return loadStrategy(supabase, userId);
}

export async function loadStrategyById(
  supabase: SupabaseServerClient,
  userId: string,
  strategyId: string,
): Promise<StrategyProfile> {
  return loadStrategy(supabase, userId, strategyId);
}

async function loadStrategy(
  supabase: SupabaseServerClient,
  userId: string,
  strategyId?: string,
): Promise<StrategyProfile> {
  let profileQuery = supabase
    .from('strategy_profiles')
    .select('*')
    .eq('user_id', userId);

  profileQuery = strategyId
    ? profileQuery.eq('id', strategyId)
    : profileQuery.eq('is_default', true).eq('is_archived', false);

  const { data: profile, error: profileError } = await profileQuery.maybeSingle();

  if (profileError) throw profileError;
  if (!profile) {
    if (strategyId) throw new StrategyNotFoundError();
    throw new NoActiveStrategyError();
  }

  const [instrumentResult, sessionResult, ruleResult, stopResult] = await Promise.all([
    supabase
      .from('strategy_instruments')
      .select('*')
      .eq('strategy_id', profile.id)
      .eq('user_id', userId)
      .eq('enabled', true)
      .order('sort_order'),
    supabase
      .from('strategy_sessions')
      .select('*')
      .eq('strategy_id', profile.id)
      .eq('user_id', userId)
      .order('created_at'),
    supabase
      .from('strategy_rules')
      .select('*')
      .eq('strategy_id', profile.id)
      .eq('user_id', userId)
      .order('sort_order'),
    supabase
      .from('strategy_stop_limits')
      .select('*')
      .eq('strategy_id', profile.id)
      .eq('user_id', userId),
  ]);

  for (const result of [instrumentResult, sessionResult, ruleResult, stopResult]) {
    if (result.error) throw result.error;
  }

  const instruments = (instrumentResult.data ?? []).map((row: any) => row.symbol);
  const sessions: StrategySession[] = (sessionResult.data ?? []).map((row: any) => ({
    id: row.id,
    sessionCode: row.session_code,
    name: row.name,
    timezone: row.timezone,
    startTime: row.start_time,
    endTime: row.end_time,
    days: row.days ?? [1, 2, 3, 4, 5],
    allowOpenOutside: Boolean(row.allow_open_outside),
    allowHoldOutside: Boolean(row.allow_hold_outside),
    isCustom: Boolean(row.is_custom),
  }));

  const rules: StrategyRule[] = (ruleResult.data ?? []).map((row: any) => ({
    ruleKey: row.rule_key,
    label: row.label,
    enabled: Boolean(row.enabled),
    mandatory: Boolean(row.mandatory),
    weight: Number(row.weight),
    minimumConfidence: Number(row.minimum_confidence),
    timeframeRole: row.timeframe_role,
  }));

  const stopLimitSettings: StopLimit[] = (stopResult.data ?? []).map((row: any) => ({
    instrument: row.instrument,
    method: row.method,
    minimumValue: Number(row.minimum_value ?? 0),
    preferredValue: Number(row.preferred_value ?? row.maximum_value),
    maximumValue: Number(row.maximum_value),
    atrMultiplier: row.atr_multiplier == null ? undefined : Number(row.atr_multiplier),
  }));

  const evidenceWeights:Record<string,number> = {};
  const requiredEvidence: EvidenceKey[] = [];

  for (const rule of rules) {
    if (!evidenceKeys.includes(rule.ruleKey as EvidenceKey) || !rule.enabled) continue;
    const key = rule.ruleKey as EvidenceKey;
    evidenceWeights[key] = rule.weight;
    if (rule.mandatory) requiredEvidence.push(key);
  }
  if(!rules.length)Object.assign(evidenceWeights,profile.evidence_weights??{});

  const allowedSessions = sessions.length
    ? sessions.map((session) => session.sessionCode)
    : profile.allowed_sessions ?? [];

  const strategy:StrategyProfile = {
    id: profile.id,
    name: profile.name,
    description: profile.description ?? '',
    isDefault: Boolean(profile.is_default),
    isArchived: Boolean(profile.is_archived),
    marketTypes: profile.market_types ?? [],
    instruments: instruments.length ? instruments : profile.instruments ?? [],
    macroTimeframe: profile.macro_timeframe ?? undefined,
    trendTimeframe: profile.trend_timeframe,
    confirmationTimeframe: profile.confirmation_timeframe,
    entryTimeframe: profile.entry_timeframe,
    triggerTimeframe: profile.trigger_timeframe ?? undefined,
    minimumRR: Number(profile.minimum_rr),
    preferredRR: Number(profile.preferred_rr ?? profile.minimum_rr),
    maximumRiskPercent: Number(profile.maximum_risk_percent),
    maximumDailyRiskPercent: Number(profile.maximum_daily_risk_percent ?? 1.5),
    maximumWeeklyRiskPercent: Number(profile.maximum_weekly_risk_percent ?? 4),
    maximumDailyLossPercent: Number(profile.maximum_daily_loss_percent ?? 2),
    maximumTotalExposurePercent: Number(profile.maximum_total_exposure_percent ?? 2),
    maximumCurrencyExposurePercent: Number(profile.maximum_currency_exposure_percent ?? 1),
    maximumTradesPerDay: Number(profile.maximum_trades_per_day),
    instrumentTradeLimits: profile.instrument_trade_limits ?? {},
    greenDayProtectionEnabled: Boolean(profile.green_day_protection_enabled),
    greenDayProtectedFloorMode: profile.green_day_protected_floor_mode ?? 'ZERO',
    greenDayProtectedFloorValue: Number(profile.green_day_protected_floor_value ?? 0),
    greenDayMaxExtraTrades: Number(profile.green_day_max_extra_trades ?? 1),
    greenDayExtraRiskMultiplier: Number(profile.green_day_extra_risk_multiplier ?? 0.5),
    greenDayRequireAuthorized: profile.green_day_require_authorized !== false,
    maximumConsecutiveLosses: Number(profile.maximum_consecutive_losses ?? profile.loss_streak_limit ?? 5),
    allowedSessions,
    sessions,
    avoidHighImpactNews: Boolean(profile.avoid_high_impact_news),
    newsMode: profile.news_mode ?? 'RELEVANT_CURRENCIES',
    newsBlockMinutesBefore: Number(profile.news_block_minutes_before ?? 30),
    newsBlockMinutesAfter: Number(profile.news_block_minutes_after ?? 15),
    newsCurrencies: profile.news_currencies ?? ['USD', 'GBP', 'JPY'],
    requireTrendAlignment: Boolean(profile.require_trend_alignment),
    requiredEvidence: requiredEvidence.length ? requiredEvidence : profile.required_evidence ?? [],
    evidenceWeights,
    rules,
    stopLimits: profile.stop_limits ?? {},
    stopLimitSettings,
    authorizationScore: Number(profile.authorization_score),
    waitScore: Number(profile.wait_score),
    lossStreakLimit: Number(profile.loss_streak_limit ?? profile.maximum_consecutive_losses ?? 5),
    preferredSetups: profile.preferred_setups ?? [],
    rejectUnlistedSetups: Boolean(profile.reject_unlisted_setups),
    trailingConfig: profile.trailing_config ?? {},
    exitConfig: profile.exit_config ?? {},
    monitorConfig: profile.monitor_config ?? {},
    tradingStyle: profile.trading_style ?? 'day-trading',
    minimumHoldingMinutes: Number(profile.minimum_holding_minutes ?? 15),
    strategyMethodologies: profile.strategy_methodologies ?? [],
    personalRules: profile.personal_rules ?? [],
    aiBehavior: profile.ai_behavior ?? undefined,
  };
  normalizeStrategyPolicy(strategy);
  return strategy;
}
