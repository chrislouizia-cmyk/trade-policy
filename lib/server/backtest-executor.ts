import 'server-only';

import { twelveDataSymbolFor } from '@/lib/instrument-registry';

import { buildLiveAnalysis, type Candle } from '@/lib/market-analysis';
import { evaluateHistoricalRulePlan } from '@/lib/backtesting/historical-detectors';
import { assertHistoricalRulePlanSupported, buildHistoricalRulePlan, type HistoricalRulePlan } from '@/lib/backtesting/historical-rule-plan';
import { strategyTimeframes } from '@/lib/strategy-timeframes';
import type { BacktestRun } from '@/types/backtesting';
import type { StrategyProfile } from '@/types/trade';
import { HISTORICAL_TIMEFRAMES } from '@/lib/backtesting/historical-timeframes';

const FRAME_MINUTES: Record<string, number> = Object.fromEntries(Object.entries(HISTORICAL_TIMEFRAMES).map(([timeframe, capability]) => [timeframe, capability.minutes]));
const TWELVE_INTERVAL: Record<string, string> = Object.fromEntries(Object.entries(HISTORICAL_TIMEFRAMES).map(([timeframe, capability]) => [timeframe, capability.providerInterval]));

type SimulatedTrade = {
  sequence: number; signal_timestamp: string; entry_timestamp: string; exit_timestamp: string;
  instrument: string; direction: 'LONG' | 'SHORT'; entry: number; stop_loss: number; take_profit: number;
  exit_price: number; risk_percent: number; risk_amount: number; balance_before: number; balance_after: number;
  gross_r: number; net_r: number; gross_pnl: number; net_pnl: number; spread_cost: number; slippage_cost: number;
  commission_cost: number; setup_type: string | null; session: string | null;
  authoritative_rule_snapshot: Record<string, unknown>; entry_reason: string; exit_reason: string;
  ambiguous_intrabar: boolean; simulation_metadata: Record<string, unknown>;
};

export type BacktestExecutionOutput = {
  complete: true;
  result: Record<string, unknown>;
  trades: SimulatedTrade[];
  metadata: Record<string, unknown>;
};

export type BacktestSimulationCheckpoint = {
  version: 1;
  runId: string;
  nextExecutionIndex: number;
  pointers: Record<string, number>;
  balance: number;
  trades: SimulatedTrade[];
  dailyCounts: Record<string, number>;
  diagnostics: BacktestDiagnostics;
};

export type BacktestExecutionProgress = {
  complete: false;
  checkpoint: BacktestSimulationCheckpoint;
  progressPercent: number;
  evaluatedCandles: number;
  tradesProduced: number;
};

type BacktestSimulationOptions = {
  checkpoint?: BacktestSimulationCheckpoint | null;
  deadlineMs?: number;
};

type BacktestDiagnostics = {
  execution_candles_evaluated: number;
  multi_timeframe_context_ready: number;
  analysis_completed: number;
  analysis_errors: number;
  ready_candidate_found: number;
  setup_readiness_ready: number;
  direction_allowed: number;
  daily_limit_allowed: number;
  valid_risk_geometry: number;
  executable_signals: number;
  completed_trades: number;
  insufficient_history: number;
  rejected_no_ready_candidate: number;
  rejected_setup_not_ready: number;
  rejected_direction: number;
  rejected_daily_limit: number;
  rejected_invalid_risk_geometry: number;
  rejected_historical_rules: number;
};


export function strategyFromSnapshot(run: BacktestRun): StrategyProfile {
  const value = run.strategy_snapshot_json as Partial<StrategyProfile> | null;
  if (!value || !Array.isArray(value.rules) || !value.trendTimeframe || !value.confirmationTimeframe || !value.entryTimeframe) {
    throw new Error('This queued run was created before authoritative rule snapshots were enabled. It was released without consuming a credit; queue a new backtest.');
  }
  return value as StrategyProfile;
}

function configuredDirection(strategy: StrategyProfile): 'LONG' | 'SHORT' | 'BOTH' {
  const raw = strategy.personalRules?.find((rule) => rule.key === 'trade-police-v2-metadata')?.value;
  if (typeof raw !== 'string') return 'BOTH';
  try {
    const parsed = JSON.parse(raw) as { direction?: string };
    return parsed.direction === 'LONG' || parsed.direction === 'SHORT' || parsed.direction === 'BOTH' ? parsed.direction : 'BOTH';
  } catch {
    return 'BOTH';
  }
}

function historicalPlan(strategy: StrategyProfile): HistoricalRulePlan {
  const frozen = (strategy as StrategyProfile & { historicalRulePlan?: HistoricalRulePlan }).historicalRulePlan;
  return frozen?.version ? frozen : buildHistoricalRulePlan(strategy);
}

function historicalFrames(strategy: StrategyProfile, plan: HistoricalRulePlan): string[] {
  return [...new Set([...strategyTimeframes(strategy), ...plan.rules.flatMap((rule) => rule.timeframes)])];
}

function historicalWarmupBars(plan: HistoricalRulePlan, timeframe: string): number {
  const numericParameters = plan.rules
    .filter((rule) => rule.timeframes.includes(timeframe))
    .flatMap((rule) => Object.values(rule.parameters).filter((value): value is number => typeof value === 'number' && Number.isFinite(value)));
  return Math.max(120, ...numericParameters.map((value) => Math.ceil(value) + 10));
}

function isoWithoutZone(value: number) {
  return new Date(value).toISOString().slice(0, 19);
}

async function fetchHistoricalFrame(instrument: string, timeframe: string, startAt: string, endAt: string): Promise<Candle[]> {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) throw new Error('TWELVE_DATA_API_KEY is not configured for the backtest executor.');
  const minutes = FRAME_MINUTES[timeframe];
  const interval = TWELVE_INTERVAL[timeframe];
  if (!minutes || !interval) throw new Error(`Historical backtesting does not yet support timeframe ${timeframe}.`);

  const startMs = Date.parse(startAt);
  const endMs = Date.parse(endAt);
  const chunkSpanMs = minutes * 60_000 * 4_500;
  const rows = new Map<string, Candle>();
  let cursor = startMs;
  let chunks = 0;

  while (cursor < endMs) {
    if (++chunks > 40) throw new Error(`Historical request for ${timeframe} exceeded the safe chunk limit.`);
    const chunkEnd = Math.min(endMs, cursor + chunkSpanMs);
    const url = new URL('https://api.twelvedata.com/time_series');
    const params = {
      symbol: twelveDataSymbolFor(instrument), interval, timezone: 'UTC',
      start_date: isoWithoutZone(cursor), end_date: isoWithoutZone(chunkEnd), order: 'ASC', apikey: apiKey,
    };
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const response = await fetch(url, { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok || payload?.status === 'error') {
      throw new Error(`Twelve Data ${timeframe} request failed: ${payload?.message ?? `HTTP ${response.status}`}`);
    }
    if (!Array.isArray(payload?.values)) throw new Error(`Twelve Data ${timeframe} response did not contain historical candles.`);

    for (const row of payload.values) {
      const datetime = `${String(row.datetime).replace(' ', 'T')}Z`;
      const candle: Candle = {
        datetime, open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close),
        ...(row.volume == null ? {} : { volume: Number(row.volume) }),
      };
      if (![candle.open, candle.high, candle.low, candle.close].every(Number.isFinite)) {
        throw new Error(`Twelve Data ${timeframe} returned invalid OHLC data at ${datetime}.`);
      }
      rows.set(datetime, candle);
    }
    cursor = chunkEnd;
  }

  const candles = [...rows.values()].sort((a, b) => Date.parse(a.datetime) - Date.parse(b.datetime));
  if (!candles.length) throw new Error(`No ${timeframe} candles were returned for the requested historical period.`);
  return candles;
}

function maxDrawdown(balances: number[]) {
  let peak = balances[0] ?? 0, maxAmount = 0, maxPercent = 0;
  for (const balance of balances) {
    peak = Math.max(peak, balance);
    const amount = peak - balance;
    const percent = peak > 0 ? amount / peak * 100 : 0;
    maxAmount = Math.max(maxAmount, amount);
    maxPercent = Math.max(maxPercent, percent);
  }
  return { amount: maxAmount, percent: maxPercent };
}

function round(value: number, digits = 6) {
  return Number(value.toFixed(digits));
}

function buildMetrics(startingBalance: number, trades: SimulatedTrade[]) {
  const endingBalance = trades.at(-1)?.balance_after ?? startingBalance;
  const wins = trades.filter((trade) => trade.net_pnl > 0);
  const losses = trades.filter((trade) => trade.net_pnl < 0);
  const breakeven = trades.length - wins.length - losses.length;
  const grossProfit = wins.reduce((sum, trade) => sum + trade.net_pnl, 0);
  const grossLoss = losses.reduce((sum, trade) => sum + trade.net_pnl, 0);
  const totalCosts = trades.reduce((sum, trade) => sum + trade.spread_cost + trade.slippage_cost + trade.commission_cost, 0);
  const rs = trades.map((trade) => trade.net_r);
  const winRs = wins.map((trade) => trade.net_r);
  const lossRs = losses.map((trade) => trade.net_r);
  const dd = maxDrawdown([startingBalance, ...trades.map((trade) => trade.balance_after)]);
  return {
    ending_balance: round(endingBalance, 2),
    net_return_percent: round((endingBalance - startingBalance) / startingBalance * 100, 4),
    total_trades: trades.length, wins: wins.length, losses: losses.length, breakeven,
    win_rate: trades.length ? round(wins.length / trades.length * 100, 4) : 0,
    profit_factor: grossLoss < 0 ? round(grossProfit / Math.abs(grossLoss), 4) : null,
    expectancy_r: rs.length ? round(rs.reduce((a, b) => a + b, 0) / rs.length, 4) : 0,
    average_r: rs.length ? round(rs.reduce((a, b) => a + b, 0) / rs.length, 4) : 0,
    average_win_r: winRs.length ? round(winRs.reduce((a, b) => a + b, 0) / winRs.length, 4) : 0,
    average_loss_r: lossRs.length ? round(lossRs.reduce((a, b) => a + b, 0) / lossRs.length, 4) : 0,
    max_drawdown_percent: round(dd.percent, 4),
    max_drawdown_amount: round(dd.amount, 2),
    gross_profit: round(grossProfit, 2), gross_loss: round(grossLoss, 2), total_costs: round(totalCosts, 2),
    cost_model: 'OHLC_NO_HISTORICAL_SPREAD_DATA', ambiguous_intrabar_policy: 'STOP_FIRST',
  };
}

export function simulateBacktestFromSeries(
  run: BacktestRun,
  strategy: StrategyProfile,
  historical: Record<string, Candle[]>,
  options: BacktestSimulationOptions = {},
): BacktestExecutionOutput | BacktestExecutionProgress {
  const rulePlan = historicalPlan(strategy);
  assertHistoricalRulePlanSupported(rulePlan);
  const periodStart = Date.parse(run.period_start);
  const requestedPeriodEnd = Date.parse(run.period_end);
  const executionFrame = run.execution_timeframe || strategy.triggerTimeframe || strategy.entryTimeframe;
  const executionMinutes = FRAME_MINUTES[executionFrame];
  const execution = historical[executionFrame];
  if (!executionMinutes || !execution?.length) throw new Error(`Execution timeframe ${executionFrame} has no historical data.`);

  const frames = historicalFrames(strategy, rulePlan);
  const historyBars = Math.max(...frames.map((frame) => historicalWarmupBars(rulePlan, frame)));
  const availableFrameEnds = frames.map((frame) => {
    const data = historical[frame] ?? [];
    const last = data.at(-1);
    const frameMinutes = FRAME_MINUTES[frame] ?? 0;
    return last ? Date.parse(last.datetime) + frameMinutes * 60_000 : Number.NaN;
  }).filter(Number.isFinite);
  const commonHistoricalEnd = availableFrameEnds.length
    ? Math.min(...availableFrameEnds)
    : requestedPeriodEnd;
  const effectivePeriodEnd = Math.min(requestedPeriodEnd, commonHistoricalEnd);
  const restored = options.checkpoint?.version === 1 && options.checkpoint.runId === run.id
    ? options.checkpoint
    : null;
  const pointers = restored
    ? { ...restored.pointers }
    : Object.fromEntries(frames.map((frame) => [frame, 0])) as Record<string, number>;
  const desiredDirection = configuredDirection(strategy);
  const trades: SimulatedTrade[] = restored ? [...restored.trades] : [];
  const dailyCounts = new Map<string, number>(Object.entries(restored?.dailyCounts ?? {}));
  let balance = restored?.balance ?? Number(run.starting_balance);
  const diagnostics: BacktestDiagnostics = restored ? { ...restored.diagnostics } : {
    execution_candles_evaluated: 0,
    multi_timeframe_context_ready: 0,
    analysis_completed: 0,
    analysis_errors: 0,
    ready_candidate_found: 0,
    setup_readiness_ready: 0,
    direction_allowed: 0,
    daily_limit_allowed: 0,
    valid_risk_geometry: 0,
    executable_signals: 0,
    completed_trades: 0,
    insufficient_history: 0,
    rejected_no_ready_candidate: 0,
    rejected_setup_not_ready: 0,
    rejected_direction: 0,
    rejected_daily_limit: 0,
    rejected_invalid_risk_geometry: 0,
    rejected_historical_rules: 0,
  };
  let initialIndex = execution.findIndex((candle) => Date.parse(candle.datetime) >= periodStart);
  if (initialIndex < 0) initialIndex = 0;
  let i = Math.max(initialIndex, restored?.nextExecutionIndex ?? initialIndex);

  while (i < execution.length - 1) {
    if (options.deadlineMs && Date.now() >= options.deadlineMs) {
      return {
        complete: false,
        checkpoint: {
          version: 1,
          runId: run.id,
          nextExecutionIndex: i,
          pointers: { ...pointers },
          balance,
          trades,
          dailyCounts: Object.fromEntries(dailyCounts),
          diagnostics,
        },
        progressPercent: round(Math.min(99, Math.max(0, (i - initialIndex) / Math.max(1, execution.length - 1 - initialIndex) * 100)), 2),
        evaluatedCandles: diagnostics.execution_candles_evaluated,
        tradesProduced: trades.length,
      };
    }
    const signalCandle = execution[i]!;
    const signalOpen = Date.parse(signalCandle.datetime);
    const signalAtMs = signalOpen + executionMinutes * 60_000;
    if (signalAtMs >= effectivePeriodEnd) break;
    diagnostics.execution_candles_evaluated += 1;

    const series: Record<string, Candle[]> = {};
    let enough = true;
    for (const frame of frames) {
      const data = historical[frame] ?? [];
      const frameMs = (FRAME_MINUTES[frame] ?? 0) * 60_000;
      let pointer = pointers[frame] ?? 0;
      while (pointer < data.length && Date.parse(data[pointer]!.datetime) + frameMs <= signalAtMs) pointer += 1;
      pointers[frame] = pointer;
      const slice = data.slice(Math.max(0, pointer - historyBars), pointer);
      if (slice.length < 25) enough = false;
      series[frame] = slice;
    }
    if (!enough) {
      diagnostics.insufficient_history += 1;
      i += 1;
      continue;
    }
    diagnostics.multi_timeframe_context_ready += 1;

    const historicalRules = evaluateHistoricalRulePlan(rulePlan, series, run.instrument);
    if (!historicalRules.passed) {
      diagnostics.rejected_historical_rules += 1;
      i += 1;
      continue;
    }

    let analysis;
    try {
      analysis = buildLiveAnalysis(run.instrument, strategy, series, 'Twelve Data historical replay', twelveDataSymbolFor(run.instrument), new Date(signalAtMs).toISOString());
      diagnostics.analysis_completed += 1;
    } catch {
      diagnostics.analysis_errors += 1;
      i += 1;
      continue;
    }

    const candidate = analysis.candidates.find((item) => item.status === 'READY');
    if (!candidate) {
      diagnostics.rejected_no_ready_candidate += 1;
      i += 1;
      continue;
    }
    diagnostics.ready_candidate_found += 1;

    if (analysis.setupReadiness.state !== 'READY' && !rulePlan.rules.some((rule) => rule.required)) {
      diagnostics.rejected_setup_not_ready += 1;
      i += 1;
      continue;
    }
    diagnostics.setup_readiness_ready += 1;

    if (desiredDirection === 'LONG' && candidate.direction !== 'BUY') {
      diagnostics.rejected_direction += 1;
      i += 1;
      continue;
    }
    if (desiredDirection === 'SHORT' && candidate.direction !== 'SELL') {
      diagnostics.rejected_direction += 1;
      i += 1;
      continue;
    }
    diagnostics.direction_allowed += 1;

    const day = new Date(signalAtMs).toISOString().slice(0, 10);
    const maxPerDay = Number(strategy.maximumTradesPerDay ?? 0);
    if (maxPerDay > 0 && (dailyCounts.get(day) ?? 0) >= maxPerDay) {
      diagnostics.rejected_daily_limit += 1;
      i += 1;
      continue;
    }
    diagnostics.daily_limit_allowed += 1;

    const next = execution[i + 1]!;
    const direction: 'LONG' | 'SHORT' = candidate.direction === 'BUY' ? 'LONG' : 'SHORT';
    const signalEntry = (candidate.entryLow + candidate.entryHigh) / 2;
    const originalStopDistance = Math.abs(signalEntry - candidate.stopLoss);
    const originalTargetDistance = Math.abs(candidate.takeProfit - signalEntry);
    if (!(originalStopDistance > 0) || !(originalTargetDistance > 0)) {
      diagnostics.rejected_invalid_risk_geometry += 1;
      i += 1;
      continue;
    }
    diagnostics.valid_risk_geometry += 1;
    diagnostics.executable_signals += 1;

    const entry = next.open;
    const stop = direction === 'LONG' ? entry - originalStopDistance : entry + originalStopDistance;
    const target = direction === 'LONG' ? entry + originalTargetDistance : entry - originalTargetDistance;
    const riskPercent = Math.max(0.01, Number(strategy.maximumRiskPercent || 0.5));
    const riskAmount = balance * riskPercent / 100;

    let exitPrice = execution.at(-1)!.close;
    let exitIndex = execution.length - 1;
    let exitReason = 'END_OF_TEST';
    let ambiguous = false;

    for (let j = i + 1; j < execution.length; j += 1) {
      const candle = execution[j]!;
      if (Date.parse(candle.datetime) >= effectivePeriodEnd) {
        exitPrice = candle.open; exitIndex = j; exitReason = 'END_OF_TEST'; break;
      }
      const stopHit = direction === 'LONG' ? candle.low <= stop : candle.high >= stop;
      const targetHit = direction === 'LONG' ? candle.high >= target : candle.low <= target;
      if (stopHit && targetHit) {
        exitPrice = stop; exitIndex = j; exitReason = 'STOP_LOSS_AMBIGUOUS_INTRABAR'; ambiguous = true; break;
      }
      if (stopHit) { exitPrice = stop; exitIndex = j; exitReason = 'STOP_LOSS'; break; }
      if (targetHit) { exitPrice = target; exitIndex = j; exitReason = 'TAKE_PROFIT'; break; }
      if (j === execution.length - 1) { exitPrice = candle.close; exitIndex = j; }
    }

    const signedMove = direction === 'LONG' ? exitPrice - entry : entry - exitPrice;
    const grossR = signedMove / Math.abs(entry - stop);
    const grossPnl = grossR * riskAmount;
    const balanceBefore = balance;
    balance += grossPnl;

    trades.push({
      sequence: trades.length + 1,
      signal_timestamp: new Date(signalAtMs).toISOString(),
      entry_timestamp: next.datetime,
      exit_timestamp: execution[exitIndex]!.datetime,
      instrument: run.instrument,
      direction,
      entry: round(entry),
      stop_loss: round(stop),
      take_profit: round(target),
      exit_price: round(exitPrice),
      risk_percent: round(riskPercent, 4),
      risk_amount: round(riskAmount, 2),
      balance_before: round(balanceBefore, 2),
      balance_after: round(balance, 2),
      gross_r: round(grossR, 4),
      net_r: round(grossR, 4),
      gross_pnl: round(grossPnl, 2),
      net_pnl: round(grossPnl, 2),
      spread_cost: 0, slippage_cost: 0, commission_cost: 0,
      setup_type: analysis.setupType ?? null,
      session: null,
      authoritative_rule_snapshot: {
        strategy_revision_id: run.strategy_revision_id,
        rules: strategy.rules ?? [],
        readiness: analysis.setupReadiness,
        evidence: analysis.evidence,
        historical_rule_plan: rulePlan,
        historical_rule_evaluations: historicalRules.evaluations,
      },
      entry_reason: candidate.rationale,
      exit_reason: exitReason,
      ambiguous_intrabar: ambiguous,
      simulation_metadata: {
        engine: 'TRADE_POLICE_BACKTEST_V1',
        execution_model: run.execution_model,
        cost_model: 'OHLC_NO_HISTORICAL_SPREAD_DATA',
        ambiguous_intrabar_policy: 'STOP_FIRST',
      },
    });

    diagnostics.completed_trades += 1;
    dailyCounts.set(day, (dailyCounts.get(day) ?? 0) + 1);
    i = Math.max(i + 1, exitIndex + 1);
  }

  const result = buildMetrics(Number(run.starting_balance), trades);
  return {
    complete: true,
    result,
    trades,
    metadata: {
      executor: 'TRADE_POLICE_BACKTEST_V1',
      provider: 'Twelve Data',
      strategy_revision_id: run.strategy_revision_id,
      execution_timeframe: executionFrame,
      evaluated_frames: frames,
      completed_trade_count: trades.length,
      requested_period_end: run.period_end,
      effective_period_end: new Date(effectivePeriodEnd).toISOString(),
      data_freshness_seconds: Math.max(0, Math.round((requestedPeriodEnd - effectivePeriodEnd) / 1000)),
      sample_quality: trades.length < 10
        ? { code: 'INSUFFICIENT', label: 'Insufficient sample', minimum_recommended_trades: 10 }
        : trades.length < 30
          ? { code: 'VERY_LIMITED', label: 'Very limited sample', minimum_recommended_trades: 30 }
          : trades.length < 100
            ? { code: 'LIMITED', label: 'Limited / preliminary sample', minimum_recommended_trades: 100 }
            : { code: 'MORE_INFORMATIVE', label: 'More informative sample', minimum_recommended_trades: 100 },
      opportunity_funnel: diagnostics,
      cost_model: 'OHLC_NO_HISTORICAL_SPREAD_DATA',
      note: 'Historical OHLC replay. Historical spread, commission, news, and external/manual confirmations are not inferred.',
    },
  };
}

export async function executeBacktestRun(run: BacktestRun): Promise<BacktestExecutionOutput> {
  const strategy = strategyFromSnapshot(run);
  const rulePlan = historicalPlan(strategy);
  assertHistoricalRulePlanSupported(rulePlan);
  const frames = [...new Set([...historicalFrames(strategy, rulePlan), run.execution_timeframe])];
  const historical: Record<string, Candle[]> = {};
  const periodStart = Date.parse(run.period_start);
  const periodEnd = Date.parse(run.period_end);

  for (const frame of frames) {
    const minutes = FRAME_MINUTES[frame];
    if (!minutes || !TWELVE_INTERVAL[frame]) throw new Error(`Historical backtesting does not yet support timeframe ${frame}.`);
    const warmupStart = new Date(periodStart - minutes * 60_000 * historicalWarmupBars(rulePlan, frame)).toISOString();
    historical[frame] = await fetchHistoricalFrame(run.instrument, frame, warmupStart, new Date(periodEnd).toISOString());
  }
  const output = simulateBacktestFromSeries(run, strategy, historical);
  if (!output.complete) throw new Error('Unbounded backtest execution unexpectedly returned a checkpoint.');
  return output;
}
