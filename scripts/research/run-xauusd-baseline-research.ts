import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { GOLD_INTRADAY_RESEARCH_V1 } from '../../lib/market-intelligence-lab/strategy-registry/gold-intraday-research-strategy.ts';
import {
  buildResearchBundle, createStrategyMappingSnapshot, importDatasetArtifact, ledgerCsv, metricsFromLedger,
  type CostScenario, type ExecutableStrategy,
} from '../../lib/backtesting/index.ts';

const RESEARCH_ID = 'TP-BT-XAUUSD-M15-2023-V1';
const sourceRoot = new URL('../../research/source-data/TP-XAUUSD-M15-2023-05-01-2023-11-01/', import.meta.url);
const outputRoot = new URL(`../../research/results/${RESEARCH_ID}/`, import.meta.url);
try { await access(outputRoot, constants.F_OK); throw new Error(`${RESEARCH_ID} already exists and is immutable.`); } catch (error) { if (error instanceof Error && error.message.includes('already exists')) throw error; }

const [bytes, certificationText] = await Promise.all([readFile(new URL('candles.json', sourceRoot)), readFile(new URL('certification.json', sourceRoot), 'utf8')]);
const certification = JSON.parse(certificationText) as { certificationHash: string; acquisition: { provider: string; providerSymbol: string; timezone: string; acquiredAt: string } };
const artifact = importDatasetArtifact({ bytes, format: 'JSON', instrument: 'XAUUSD', provider: certification.acquisition.provider, providerSymbol: certification.acquisition.providerSymbol, timeframe: 'M15', timezone: certification.acquisition.timezone, pricePrecision: 5, importTimestamp: certification.acquisition.acquiredAt, sourceFilename: 'candles.json', duplicateTimestampPolicy: 'REJECT', priceRepresentation: 'UNKNOWN', sourceVerificationReference: `TP-REP certification ${certification.certificationHash}` });

const executable = Object.freeze({
  id: GOLD_INTRADAY_RESEARCH_V1.id, name: GOLD_INTRADAY_RESEARCH_V1.name, version: GOLD_INTRADAY_RESEARCH_V1.version, direction: 'LONG',
  entryRules: Object.freeze([
    { id: 'trend-alignment', type: 'SMA_RELATION', fastPeriod: 10, slowPeriod: 24, relation: 'ABOVE', closeMustConfirmSlow: true, required: true },
    { id: 'retest', type: 'LEGACY_RETEST', atrPeriod: 14, lookback: 7, toleranceAtrMultiple: .35, tolerancePriceMultiple: .0002, trendFastPeriod: 10, trendSlowPeriod: 24, required: false },
    { id: 'displacement', type: 'LEGACY_DISPLACEMENT', atrPeriod: 14, atrMultiple: 1.1, bodyRangeRatio: .65, required: false },
  ] as const),
  forbiddenRules: Object.freeze([]),
  stopLossRule: { type: 'ATR_MULTIPLE', period: 14, multiple: 1 },
  takeProfitRule: { type: 'ATR_MULTIPLE', period: 14, multiple: 2 },
  maximumHoldingPeriod: 20, minimumRequiredConfirmations: 2,
  executionDefinition: { entry: 'NEXT_OPEN', invalidation: 'STOP_PRICE', exit: 'TARGET_OR_MAX_HOLDING', maximumHoldingBars: 20, assumptionsVersion: 'gold-intraday-research-execution@1.0.0', intrabarConflictPolicy: 'STOP_FIRST', allowOverlappingTrades: false, costs: { commissionR: .02, spreadPrice: .2, slippagePrice: .05 }, source: 'EXPLICIT_IMMUTABLE_MAPPING' },
} satisfies ExecutableStrategy);
const original = structuredClone(GOLD_INTRADAY_RESEARCH_V1) as unknown as Readonly<Record<string, unknown>>;
const mapping = createStrategyMappingSnapshot({
  strategyId: GOLD_INTRADAY_RESEARCH_V1.id, strategyVersion: GOLD_INTRADAY_RESEARCH_V1.version, strategyName: GOLD_INTRADAY_RESEARCH_V1.name,
  originalStoredStrategyDna: Object.freeze({ ...original, requiredRuleIds: ['trend-alignment'] }), mappedExecutableStrategy: executable,
  supportedRules: Object.freeze(['trend-alignment', 'retest', 'displacement']), partiallySupportedRules: Object.freeze([]), unsupportedRules: Object.freeze([]),
  omittedFields: Object.freeze(['validation.description', 'validation.tags', 'validation.author']),
  interpretationDecisions: Object.freeze([
    'The 50/25/25 confidence weights and 70% policy threshold are mapped to required trend alignment plus at least one of retest or displacement (minimum two confirmations).',
    'Trend uses the exact legacy SMA10>SMA24 and close>SMA24 bullish formula.',
    'Retest and displacement use their exact legacy formulas.',
    'The stored composition definition has no exit rules; the baseline preregisters ATR(14) 1.0x stop, ATR(14) 2.0x target, and 20-bar maximum holding solely as transparent execution assumptions.',
  ]),
  mappingWarnings: Object.freeze(['Stop, target, and maximum holding period are research execution assumptions absent from the stored Strategy DNA; conclusions are conditional on them.']),
});
const config = (spreadPrice: number, slippagePrice: number, commissionR: number) => Object.freeze({ entryTiming: 'NEXT_OPEN' as const, intrabarConflictPolicy: 'STOP_FIRST' as const, allowOverlappingTrades: false, costs: Object.freeze({ spreadPrice, slippagePrice, commissionR }), maximumHoldingBars: 20 });
const scenarios: readonly CostScenario[] = Object.freeze([
  { id: 'IDEALIZED', description: 'Zero friction research boundary.', configuration: config(0, 0, 0) },
  { id: 'EXPECTED', description: 'Fixed 0.20 XAUUSD spread, 0.05 price slippage each side, and 0.02R commission.', configuration: config(.2, .05, .02) },
  { id: 'CONSERVATIVE', description: 'Fixed 0.40 XAUUSD spread, 0.10 price slippage each side, and 0.04R commission.', configuration: config(.4, .1, .04) },
]);
const bundle = buildResearchBundle(artifact, mapping, scenarios);
const recalculated = metricsFromLedger(bundle.ledger);
if (JSON.stringify(recalculated) !== JSON.stringify(bundle.baseline.metrics)) throw new Error('Ledger-derived metrics do not match baseline engine metrics.');
const summary = Object.freeze({
  researchId: RESEARCH_ID, gitCommitSha: process.env.GIT_COMMIT_SHA ?? '', dataset: artifact.metadata, datasetValidation: artifact.validation,
  strategyMappingHash: mapping.mappingHash, baselineRunId: bundle.baseline.reproducibility.runId, baseline: { metrics: bundle.baseline.metrics, inSample: bundle.baseline.inSample.metrics, outOfSample: bundle.baseline.outOfSample.metrics, classification: bundle.baseline.classification, warnings: bundle.baseline.warnings },
  sensitivity: bundle.sensitivity.map((item) => ({ id: item.scenario.id, description: item.scenario.description, costs: item.scenario.configuration.costs, metrics: item.result.metrics, classification: item.result.classification })),
  yearly: bundle.yearly, quarterly: bundle.quarterly, marketSegments: bundle.marketSegments, stabilityWarnings: bundle.stabilityWarnings,
  signalAccounting: { signalsFound: bundle.baseline.metrics.totalSignals, tradesExecuted: bundle.baseline.metrics.totalExecutedTrades, skipped: bundle.baseline.skippedSignals.length, skippedByReason: Object.fromEntries([...new Set(bundle.baseline.skippedSignals.map((item) => item.reason))].map((reason) => [reason, bundle.baseline.skippedSignals.filter((item) => item.reason === reason).length])) },
  ledgerMetricsMatch: true,
});
await mkdir(outputRoot, { recursive: true });
await Promise.all([
  writeFile(new URL('dataset-artifact.json', outputRoot), `${JSON.stringify({ metadata: artifact.metadata, validation: artifact.validation }, null, 2)}\n`, { flag: 'wx' }),
  writeFile(new URL('strategy-mapping.json', outputRoot), `${JSON.stringify(mapping, null, 2)}\n`, { flag: 'wx' }),
  writeFile(new URL('summary.json', outputRoot), `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' }),
  writeFile(new URL('trade-ledger.json', outputRoot), `${JSON.stringify(bundle.ledger, null, 2)}\n`, { flag: 'wx' }),
  writeFile(new URL('trade-ledger.csv', outputRoot), ledgerCsv(bundle.ledger), { flag: 'wx' }),
  writeFile(new URL('report.md', outputRoot), bundle.reportMarkdown, { flag: 'wx' }),
]);
console.log(JSON.stringify({ researchId: RESEARCH_ID, output: outputRoot.pathname, datasetHash: artifact.metadata.sha256FileHash, mappingHash: mapping.mappingHash, baselineRunId: bundle.baseline.reproducibility.runId, candles: artifact.metadata.candleCount, signals: bundle.baseline.metrics.totalSignals, trades: bundle.baseline.metrics.totalExecutedTrades, classification: bundle.baseline.classification, ledgerMetricsMatch: true }));
