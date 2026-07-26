import { stableFingerprint } from '../market-intelligence/serialization/stable-fingerprint.ts';
import { calculateMetrics } from './metrics.ts';
import { findSignalEvaluations } from './signalEvaluator.ts';
import { DEFAULT_SIMULATION_CONFIGURATION, simulateTradesWithSkips } from './tradeSimulator.ts';
import type { BacktestDataset, BacktestResult, BacktestSegmentResult, ClassificationCriteria, ResearchClassification, Signal, SimulatedTrade, SimulationConfiguration } from './types.ts';
import { DEFAULT_CLASSIFICATION_CRITERIA, validateBacktestInputs } from './validation.ts';

export const BACKTEST_ENGINE_VERSION = '1.0.0';
export type RunBacktestOptions = Readonly<{ configuration?: Partial<SimulationConfiguration> & { costs?: Partial<SimulationConfiguration['costs']> }; inSampleFraction?: number; classificationCriteria?: Partial<ClassificationCriteria>; runTimestamp?: string }>;

function segment(dataset: BacktestDataset, candlesStart: number, candlesEnd: number, signals: readonly Signal[], trades: readonly SimulatedTrade[], configuration: SimulationConfiguration): BacktestSegmentResult {
  const candles = dataset.candles.slice(candlesStart, candlesEnd);
  const start = candles[0]?.timestamp ?? dataset.startTime, end = candles.at(-1)?.timestamp ?? dataset.endTime;
  const selectedSignals = signals.filter((signal) => signal.candleIndex >= candlesStart && signal.candleIndex < candlesEnd);
  const selectedTrades = trades.filter((trade) => Date.parse(trade.signalTimestamp) >= Date.parse(start) && Date.parse(trade.signalTimestamp) <= Date.parse(end));
  return Object.freeze({ startTime: start, endTime: end, candleCount: candles.length, signals: Object.freeze(selectedSignals), trades: Object.freeze(selectedTrades), metrics: calculateMetrics(selectedTrades, selectedSignals.length, configuration.startingBalance) });
}

function profitConcentration(trades: readonly SimulatedTrade[]): number {
  const positive = trades.filter((trade) => trade.pnlR > 0).map((trade) => trade.pnlR).sort((a, b) => b - a);
  const total = positive.reduce((sum, value) => sum + value, 0);
  return total ? positive.slice(0, Math.min(5, positive.length)).reduce((sum, value) => sum + value, 0) / total : 0;
}

function classify(total: BacktestSegmentResult, outOfSample: BacktestSegmentResult, warnings: readonly string[], criteria: ClassificationCriteria): ResearchClassification {
  if (total.metrics.totalExecutedTrades < 100 || outOfSample.metrics.totalExecutedTrades < Math.min(30, criteria.minimumOutOfSampleTrades)) return 'INSUFFICIENT_DATA';
  if ((outOfSample.metrics.expectancyR ?? 0) < 0 || (outOfSample.metrics.profitFactor ?? 0) < 1) return 'NEGATIVE_EXPECTANCY';
  if (warnings.some((warning) => warning.startsWith('Critical:'))) return 'UNSTABLE';
  if (total.metrics.totalExecutedTrades >= criteria.robustMinimumTrades && outOfSample.metrics.totalExecutedTrades >= criteria.minimumOutOfSampleTrades && (outOfSample.metrics.profitFactor ?? 0) > criteria.robustMinimumOutOfSampleProfitFactor && outOfSample.metrics.maximumDrawdownR <= criteria.maximumDrawdownR && profitConcentration(outOfSample.trades) <= criteria.maximumProfitConcentration) return 'ROBUST_CANDIDATE';
  return 'PROMISING';
}

export function runBacktest(dataset: BacktestDataset, strategy: import('./types.ts').ExecutableStrategy, options: RunBacktestOptions = {}): BacktestResult {
  const configuration: SimulationConfiguration = Object.freeze({
    ...DEFAULT_SIMULATION_CONFIGURATION, maximumHoldingBars: strategy.maximumHoldingPeriod ?? DEFAULT_SIMULATION_CONFIGURATION.maximumHoldingBars, ...options.configuration,
    costs: Object.freeze({ ...DEFAULT_SIMULATION_CONFIGURATION.costs, ...options.configuration?.costs }),
  });
  const inSampleFraction = options.inSampleFraction ?? .7;
  const criteria: ClassificationCriteria = Object.freeze({ ...DEFAULT_CLASSIFICATION_CRITERIA, ...options.classificationCriteria });
  const issues = validateBacktestInputs(dataset, strategy, configuration, inSampleFraction);
  if (issues.length) throw new Error(`Invalid backtest: ${issues.join(' ')}`);
  const evaluated = findSignalEvaluations(strategy, dataset.candles), signals = evaluated.signals, simulated = simulateTradesWithSkips(signals, dataset.candles, configuration), trades = simulated.trades;
  const splitIndex = Math.max(1, Math.min(dataset.candles.length - 1, Math.floor(dataset.candles.length * inSampleFraction)));
  const inSample = segment(dataset, 0, splitIndex, signals, trades, configuration);
  const outOfSample = segment(dataset, splitIndex, dataset.candles.length, signals, trades, configuration);
  const total = segment(dataset, 0, dataset.candles.length, signals, trades, configuration);
  const warnings: string[] = [];
  if (trades.length < 2_000) warnings.push(`Only ${trades.length} genuine qualifying trades were found; fewer than the 2,000-trade research target.`);
  if ((inSample.metrics.expectancyR ?? 0) > 0 && (outOfSample.metrics.expectancyR ?? 0) <= 0) warnings.push('Critical: in-sample expectancy is positive but out-of-sample expectancy is not.');
  if ((inSample.metrics.expectancyR ?? 0) > 0 && (outOfSample.metrics.expectancyR ?? 0) < 0) warnings.push('Critical: expectancy changes from positive in-sample to negative out-of-sample.');
  if (inSample.metrics.profitFactor !== null && outOfSample.metrics.profitFactor !== null && Math.abs(inSample.metrics.profitFactor - outOfSample.metrics.profitFactor) >= criteria.substantialProfitFactorChange) warnings.push('Profit factor changes substantially between in-sample and out-of-sample periods.');
  if (outOfSample.metrics.totalExecutedTrades < criteria.minimumOutOfSampleTrades) warnings.push(`Out-of-sample contains only ${outOfSample.metrics.totalExecutedTrades} trades; ${criteria.minimumOutOfSampleTrades} are required by the configured robustness criteria.`);
  if (profitConcentration(total.trades) > criteria.maximumProfitConcentration) warnings.push('Critical: a small number of trades produce most of the gross profit.');
  const configurationHash = stableFingerprint({ strategy, dataset: { ...dataset, candles: dataset.candles }, configuration, inSampleFraction, criteria, engineVersion: BACKTEST_ENGINE_VERSION });
  const runTimestamp = options.runTimestamp ?? dataset.endTime;
  const classification = classify(total, outOfSample, warnings, criteria);
  return Object.freeze({
    configuration, strategy, datasetMetadata: { symbol: dataset.symbol, timeframe: dataset.timeframe, timezone: dataset.timezone, source: dataset.source, startTime: dataset.startTime, endTime: dataset.endTime, candleCount: dataset.candles.length },
    inSample, outOfSample, total, skippedSignals: Object.freeze([...evaluated.skipped, ...simulated.skipped]), trades: total.trades, metrics: total.metrics, warnings: Object.freeze(warnings), classification,
    reproducibility: Object.freeze({ engineVersion: BACKTEST_ENGINE_VERSION, runId: `backtest:${configurationHash}`, configurationHash, runTimestamp, deterministic: true as const }),
    walkForwardSupported: true as const,
  });
}
