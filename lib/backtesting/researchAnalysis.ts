import { stableFingerprint } from '../market-intelligence/serialization/stable-fingerprint.ts';
import { atr, sma } from './indicators.ts';
import { calculateMetrics } from './metrics.ts';
import { runBacktest } from './runBacktest.ts';
import type { ImmutableDatasetArtifact } from './datasetArtifact.ts';
import type { BacktestMetrics, BacktestResult, ExecutableStrategy, SimulatedTrade, SimulationConfiguration, SkippedSignal } from './types.ts';

export type StrategyMappingSnapshot = Readonly<{
  snapshotVersion: '1.0.0';
  strategyId: string;
  strategyVersion: string;
  strategyName: string;
  originalStoredStrategyDna: Readonly<Record<string, unknown>>;
  mappedExecutableStrategy: ExecutableStrategy;
  supportedRules: readonly string[];
  partiallySupportedRules: readonly string[];
  unsupportedRules: readonly string[];
  omittedFields: readonly string[];
  interpretationDecisions: readonly string[];
  mappingWarnings: readonly string[];
  mappingHash: string;
  immutable: true;
}>;
export type CostScenario = Readonly<{ id: 'IDEALIZED' | 'EXPECTED' | 'CONSERVATIVE'; description: string; configuration: SimulationConfiguration }>;
export type StabilitySegment = Readonly<{ key: string; trades: number; metrics: BacktestMetrics; reliable: boolean }>;
export type MarketSegment = Readonly<{ dimension: string; key: string; formula: string; trades: number; metrics: BacktestMetrics; reliable: boolean }>;
export type LedgerRow = Readonly<{
  runId: string; datasetHash: string; strategyMappingHash: string; signalTimestamp: string; entryTimestamp: string | null; exitTimestamp: string | null;
  direction: string | null; entryPrice: number | null; stopPrice: number | null; targetPrice: number | null; exitPrice: number | null;
  rawR: number | null; costAdjustedR: number | null; costsR: number | null; exitReason: string | null; barsHeld: number | null;
  mfeR: number | null; maeR: number | null; passedRules: readonly string[]; blockedRules: readonly string[]; skippedReason: string | null;
  sample: 'IS' | 'OOS'; year: number; quarter: string; session: string; weekday: string; volatilityRegime: 'LOW' | 'NORMAL' | 'HIGH' | 'UNKNOWN'; trendRegime: 'TRENDING' | 'NON_TRENDING' | 'UNKNOWN';
}>;
export type ResearchBundle = Readonly<{
  baseline: BacktestResult;
  sensitivity: readonly Readonly<{ scenario: CostScenario; result: BacktestResult }>[];
  yearly: readonly StabilitySegment[];
  quarterly: readonly StabilitySegment[];
  marketSegments: readonly MarketSegment[];
  ledger: readonly LedgerRow[];
  stabilityWarnings: readonly string[];
  reportMarkdown: string;
}>;

export function createStrategyMappingSnapshot(input: Omit<StrategyMappingSnapshot, 'snapshotVersion' | 'mappingHash' | 'immutable'>): StrategyMappingSnapshot {
  if (input.unsupportedRules.some((rule) => input.originalStoredStrategyDna.requiredRuleIds instanceof Array && input.originalStoredStrategyDna.requiredRuleIds.includes(rule))) throw new Error('INVALID_STRATEGY_MAPPING: a required Strategy DNA rule is unsupported.');
  const mappingHash = stableFingerprint(input);
  return Object.freeze({ snapshotVersion: '1.0.0', ...structuredClone(input), mappingHash, immutable: true });
}

const metricsSegment = (key: string, trades: readonly SimulatedTrade[], reliableMinimum = 30): StabilitySegment => Object.freeze({ key, trades: trades.length, metrics: calculateMetrics(trades), reliable: trades.length >= reliableMinimum });
const session = (timestamp: string): string => {
  const hour = new Date(timestamp).getUTCHours();
  if (hour >= 13 && hour < 22) return 'NEW_YORK_13_22_UTC';
  if (hour >= 7 && hour < 16) return 'LONDON_07_16_UTC';
  if (hour < 9) return 'TOKYO_00_09_UTC';
  return 'OTHER';
};
const weekday = (timestamp: string): string => ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][new Date(timestamp).getUTCDay()]!;

function conditionAt(artifact: ImmutableDatasetArtifact, timestamp: string): { volatility: LedgerRow['volatilityRegime']; trend: LedgerRow['trendRegime'] } {
  const index = artifact.dataset.candles.findIndex((candle) => candle.timestamp === timestamp);
  if (index < 0) return { volatility: 'UNKNOWN', trend: 'UNKNOWN' };
  const history = artifact.dataset.candles.slice(0, index + 1), currentAtr = atr(history, 14);
  const priorAtrValues: number[] = [];
  for (let cursor = Math.max(14, history.length - 100); cursor < history.length - 1; cursor += 1) {
    const value = atr(history.slice(0, cursor + 1), 14); if (value !== null) priorAtrValues.push(value);
  }
  const sorted = priorAtrValues.sort((a, b) => a - b), median = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : null;
  const volatility = currentAtr === null || median === null ? 'UNKNOWN' : currentAtr < median * .75 ? 'LOW' : currentAtr > median * 1.25 ? 'HIGH' : 'NORMAL';
  const fast = sma(history.map((candle) => candle.close), 10), slow = sma(history.map((candle) => candle.close), 24), close = history.at(-1)!.close;
  const trend = fast === null || slow === null ? 'UNKNOWN' : (fast > slow && close > slow) || (fast < slow && close < slow) ? 'TRENDING' : 'NON_TRENDING';
  return { volatility, trend };
}

function ledger(artifact: ImmutableDatasetArtifact, mapping: StrategyMappingSnapshot, result: BacktestResult): readonly LedgerRow[] {
  const splitTime = result.outOfSample.startTime, signals = new Map(result.total.signals.map((signal) => [signal.timestamp, signal]));
  const tradeRows = result.trades.map((trade): LedgerRow => {
    const signal = signals.get(trade.signalTimestamp), date = new Date(trade.signalTimestamp), conditions = conditionAt(artifact, trade.signalTimestamp);
    return Object.freeze({ runId: result.reproducibility.runId, datasetHash: artifact.metadata.sha256FileHash, strategyMappingHash: mapping.mappingHash, signalTimestamp: trade.signalTimestamp, entryTimestamp: trade.entryTimestamp, exitTimestamp: trade.exitTimestamp, direction: trade.direction, entryPrice: trade.entryPrice, stopPrice: trade.stopPrice, targetPrice: trade.targetPrice, exitPrice: trade.exitPrice, rawR: trade.rawPnlR, costAdjustedR: trade.pnlR, costsR: trade.costsR, exitReason: trade.exitReason, barsHeld: trade.barsHeld, mfeR: trade.maximumFavorableExcursionR, maeR: trade.maximumAdverseExcursionR, passedRules: signal?.matchedRules ?? [], blockedRules: signal?.blockedRules ?? [], skippedReason: null, sample: Date.parse(trade.signalTimestamp) < Date.parse(splitTime) ? 'IS' : 'OOS', year: date.getUTCFullYear(), quarter: `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`, session: session(trade.signalTimestamp), weekday: weekday(trade.signalTimestamp), volatilityRegime: conditions.volatility, trendRegime: conditions.trend });
  });
  const skippedRows = result.skippedSignals.map((skipped: SkippedSignal): LedgerRow => {
    const date = new Date(skipped.timestamp), conditions = conditionAt(artifact, skipped.timestamp);
    return Object.freeze({ runId: result.reproducibility.runId, datasetHash: artifact.metadata.sha256FileHash, strategyMappingHash: mapping.mappingHash, signalTimestamp: skipped.timestamp, entryTimestamp: null, exitTimestamp: null, direction: null, entryPrice: null, stopPrice: null, targetPrice: null, exitPrice: null, rawR: null, costAdjustedR: null, costsR: null, exitReason: null, barsHeld: null, mfeR: null, maeR: null, passedRules: skipped.matchedRules, blockedRules: skipped.blockedRules, skippedReason: skipped.reason, sample: Date.parse(skipped.timestamp) < Date.parse(splitTime) ? 'IS' : 'OOS', year: date.getUTCFullYear(), quarter: `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`, session: session(skipped.timestamp), weekday: weekday(skipped.timestamp), volatilityRegime: conditions.volatility, trendRegime: conditions.trend });
  });
  return Object.freeze([...tradeRows, ...skippedRows].sort((left, right) => Date.parse(left.signalTimestamp) - Date.parse(right.signalTimestamp) || Number(left.entryTimestamp !== null) - Number(right.entryTimestamp !== null)));
}

const scenarioLine = (id: string, result: BacktestResult) => `| ${id} | ${result.metrics.totalExecutedTrades} | ${result.metrics.netProfitR.toFixed(3)} | ${result.metrics.expectancyR?.toFixed(4) ?? 'n/a'} | ${result.metrics.profitFactor?.toFixed(3) ?? 'n/a'} | ${result.metrics.maximumDrawdownR.toFixed(3)} | ${result.classification} |`;

function markdown(artifact: ImmutableDatasetArtifact, mapping: StrategyMappingSnapshot, baseline: BacktestResult, sensitivity: ResearchBundle['sensitivity'], yearly: readonly StabilitySegment[], quarterly: readonly StabilitySegment[], segments: readonly MarketSegment[], warnings: readonly string[]): string {
  return `# Trade Police deterministic XAUUSD backtest\n+\n+## Research question\n+\n+Does the immutable ${mapping.strategyName} Strategy DNA produce positive and stable historical expectancy on the selected certified XAUUSD M15 dataset under fixed execution rules?\n+\n+## Dataset provenance and quality\n+\n+- Source: ${artifact.metadata.sourceFilename} (${artifact.metadata.provider}, ${artifact.metadata.providerSymbol})\n+- SHA-256: \`${artifact.metadata.sha256FileHash}\`\n+- Status: ${artifact.metadata.status}\n+- Span: ${artifact.metadata.datasetStart} — ${artifact.metadata.datasetEnd}\n+- Candles: ${artifact.metadata.candleCount}\n+- Price representation: ${artifact.metadata.priceRepresentation}\n+- Validation: ${artifact.validation.valid ? 'VALID' : 'INVALID'}; gaps=${artifact.validation.gapsInExpectedTimestamps}; duplicates=${artifact.validation.duplicateTimestamps}; missing volume=${artifact.validation.missingVolume}; weekend candles=${artifact.validation.weekendCandles}\n+\n+## Strategy DNA snapshot and mapping audit\n+\n+- Strategy: ${mapping.strategyId}@${mapping.strategyVersion}\n+- Mapping hash: \`${mapping.mappingHash}\`\n+- Supported: ${mapping.supportedRules.join(', ')}\n+- Partially supported: ${mapping.partiallySupportedRules.join(', ') || 'none'}\n+- Unsupported: ${mapping.unsupportedRules.join(', ') || 'none'}\n+- Omitted fields: ${mapping.omittedFields.join(', ') || 'none'}\n+- Interpretations: ${mapping.interpretationDecisions.join(' ')}\n+- Warnings: ${mapping.mappingWarnings.join(' ') || 'none'}\n+\n+## Baseline and IS/OOS results\n+\n+| Sample | Trades | Net R | Expectancy | Profit factor | Max drawdown R | Classification |\n+|---|---:|---:|---:|---:|---:|---|\n+${scenarioLine('Full expected-cost baseline', baseline)}\n+${scenarioLine('In sample', { ...baseline, metrics: baseline.inSample.metrics } as BacktestResult)}\n+${scenarioLine('Out of sample', { ...baseline, metrics: baseline.outOfSample.metrics } as BacktestResult)}\n+\n+Signals found=${baseline.metrics.totalSignals}; executed=${baseline.metrics.totalExecutedTrades}; skipped evaluations=${baseline.skippedSignals.length}. Entry is next candle open. Same-bar stop/target conflicts use stop first.\n+\n+## Execution-cost sensitivity\n+\n+| Scenario | Trades | Net R | Expectancy | Profit factor | Max drawdown R | Classification |\n+|---|---:|---:|---:|---:|---:|---|\n+${sensitivity.map((item) => scenarioLine(item.scenario.id, item.result)).join('\n')}\n+\n+## Yearly stability\n+\n+| Year | Trades | Win rate | Expectancy | Profit factor | Net R | Max drawdown R | Reliable |\n+|---|---:|---:|---:|---:|---:|---:|---|\n+${yearly.map((item) => `| ${item.key} | ${item.trades} | ${(item.metrics.winRate * 100).toFixed(1)}% | ${item.metrics.expectancyR?.toFixed(4) ?? 'n/a'} | ${item.metrics.profitFactor?.toFixed(3) ?? 'n/a'} | ${item.metrics.netProfitR.toFixed(3)} | ${item.metrics.maximumDrawdownR.toFixed(3)} | ${item.reliable} |`).join('\n')}\n+\n+## Quarterly and market-condition segments\n+\n+Quarterly segments: ${quarterly.map((item) => `${item.key}=${item.trades} trades, expectancy ${item.metrics.expectancyR?.toFixed(4) ?? 'n/a'}`).join('; ')}.\n+\n+${segments.map((item) => `- ${item.dimension}/${item.key}: ${item.trades} trades; expectancy=${item.metrics.expectancyR?.toFixed(4) ?? 'n/a'}; PF=${item.metrics.profitFactor?.toFixed(3) ?? 'n/a'}; reliable=${item.reliable}. Formula: ${item.formula}`).join('\n')}\n+\n+## Validation warnings and limitations\n+\n+${[...baseline.warnings, ...warnings].map((warning) => `- ${warning}`).join('\n')}\n+- This is a historical result, not guaranteed or future profitability.\n+- The historical result uses bar data; intrabar order is unknown and resolved conservatively.\n+- A positive historical expectancy would identify only a research candidate requiring further validation.\n+- Spread is fixed rather than reconstructed tick by tick; price representation limitations remain visible above.\n+\n+## Research classification\n+\n+**${baseline.classification}**\n+\n+## Reproducibility\n+\n+Re-run the frozen research command with the same source file, Strategy DNA snapshot, cost scenarios and engine commit. Baseline run ID: \`${baseline.reproducibility.runId}\`.\n+`;
}

export function buildResearchBundle(artifact: ImmutableDatasetArtifact, mapping: StrategyMappingSnapshot, scenarios: readonly CostScenario[]): ResearchBundle {
  if (artifact.metadata.status !== 'VERIFIED_SOURCE' || !artifact.validation.valid) throw new Error('Dataset must have verified origin and valid integrity before official research.');
  if (mapping.unsupportedRules.length) throw new Error('INVALID_STRATEGY_MAPPING: unsupported mapped rules remain.');
  const expected = scenarios.find((scenario) => scenario.id === 'EXPECTED');
  if (!expected) throw new Error('Expected-cost baseline scenario is required.');
  const sensitivity = scenarios.map((scenario) => Object.freeze({ scenario, result: runBacktest(artifact.dataset, mapping.mappedExecutableStrategy, { configuration: scenario.configuration, runTimestamp: artifact.metadata.datasetEnd }) }));
  const baseline = sensitivity.find((item) => item.scenario.id === 'EXPECTED')!.result;
  const years = [...new Set(baseline.trades.map((trade) => String(new Date(trade.signalTimestamp).getUTCFullYear())))];
  const quarters = [...new Set(baseline.trades.map((trade) => { const date = new Date(trade.signalTimestamp); return `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`; }))];
  const yearly = years.map((key) => metricsSegment(key, baseline.trades.filter((trade) => String(new Date(trade.signalTimestamp).getUTCFullYear()) === key)));
  const quarterly = quarters.map((key) => metricsSegment(key, baseline.trades.filter((trade) => { const date = new Date(trade.signalTimestamp); return `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}` === key; })));
  const rows = ledger(artifact, mapping, baseline), executed = rows.filter((row) => row.entryTimestamp !== null);
  const dimensions: Array<[string, keyof Pick<LedgerRow, 'direction' | 'session' | 'weekday' | 'volatilityRegime' | 'trendRegime'>, string]> = [
    ['DIRECTION', 'direction', 'Trade direction recorded by the immutable strategy.'], ['SESSION', 'session', 'UTC windows: Tokyo 00–09, London 07–16, New York 13–22; precedence NY, London, Tokyo.'],
    ['WEEKDAY', 'weekday', 'UTC calendar weekday at signal time.'], ['ATR_REGIME', 'volatilityRegime', 'ATR(14) versus median prior ATR values over at most 100 completed candles: LOW <0.75x, HIGH >1.25x, otherwise NORMAL.'],
    ['TREND_REGIME', 'trendRegime', 'TRENDING when SMA10>SMA24 and close>SMA24, or SMA10<SMA24 and close<SMA24; otherwise NON_TRENDING.'],
  ];
  const marketSegments: MarketSegment[] = dimensions.flatMap(([dimension, field, formula]) => [...new Set(executed.map((row) => String(row[field])))].map((key) => {
    const timestamps = new Set(executed.filter((row) => String(row[field]) === key).map((row) => row.signalTimestamp)), trades = baseline.trades.filter((trade) => timestamps.has(trade.signalTimestamp)), result = metricsSegment(key, trades);
    return Object.freeze({ dimension, key, formula, trades: trades.length, metrics: result.metrics, reliable: result.reliable });
  }));
  const stabilityWarnings: string[] = [];
  if (yearly.length && yearly.some((item) => item.metrics.netProfitR > 0) && yearly.some((item) => item.metrics.netProfitR < 0)) stabilityWarnings.push('Yearly net result changes sign.');
  if (quarterly.some((item) => item.trades < 10 && item.metrics.netProfitR > 0)) stabilityWarnings.push('An unusually strong quarter is based on fewer than 10 trades.');
  if (yearly.length && Math.max(...yearly.map((item) => item.metrics.netProfitR)) > baseline.metrics.grossProfitR * .5) stabilityWarnings.push('Profit is concentrated in one calendar year.');
  const reportMarkdown = markdown(artifact, mapping, baseline, sensitivity, yearly, quarterly, marketSegments, stabilityWarnings);
  return Object.freeze({ baseline, sensitivity: Object.freeze(sensitivity), yearly: Object.freeze(yearly), quarterly: Object.freeze(quarterly), marketSegments: Object.freeze(marketSegments), ledger: rows, stabilityWarnings: Object.freeze(stabilityWarnings), reportMarkdown });
}

export function ledgerCsv(rows: readonly LedgerRow[]): string {
  const headers = Object.keys(rows[0] ?? {}) as Array<keyof LedgerRow>;
  const escape = (value: unknown) => `"${String(Array.isArray(value) ? value.join('|') : value ?? '').replaceAll('"', '""')}"`;
  return `${headers.join(',')}\n${rows.map((row) => headers.map((header) => escape(row[header])).join(',')).join('\n')}\n`;
}

export function metricsFromLedger(rows: readonly LedgerRow[]): BacktestMetrics {
  const trades: SimulatedTrade[] = rows.filter((row) => row.entryTimestamp !== null).map((row) => ({
    signalTimestamp: row.signalTimestamp, entryTimestamp: row.entryTimestamp!, exitTimestamp: row.exitTimestamp!, direction: row.direction as SimulatedTrade['direction'],
    entryPrice: row.entryPrice!, stopPrice: row.stopPrice!, targetPrice: row.targetPrice!, exitPrice: row.exitPrice!, rawPnlR: row.rawR!, costsR: row.costsR!, pnlR: row.costAdjustedR!,
    outcome: row.costAdjustedR! > 0 ? 'WIN' : row.costAdjustedR! < 0 ? 'LOSS' : 'BREAK_EVEN', maximumFavorableExcursionR: row.mfeR!, maximumAdverseExcursionR: row.maeR!, barsHeld: row.barsHeld!, exitReason: row.exitReason as SimulatedTrade['exitReason'],
  }));
  const totalSignals = trades.length + rows.filter((row) => row.skippedReason === 'OVERLAPPING_TRADE' || row.skippedReason === 'NO_NEXT_CANDLE').length;
  return calculateMetrics(trades, totalSignals);
}
