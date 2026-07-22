import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { AnalysisContextBuilder } from '../../lib/market-intelligence/analysis/analysis-context-builder.ts';
import { DEFAULT_DIRECTION_POLICY } from '../../lib/market-intelligence/direction/index.ts';
import { STANDARD_ACTIONABILITY_POLICY } from '../../lib/market-intelligence/decision/index.ts';
import { DEFAULT_ENGINE_VALIDATION_PROTOCOL, EngineValidator, PipelineReplayAdapter, renderValidationReportMarkdown, type HistoricalValidationDataset } from '../../lib/market-intelligence/engine-validation/index.ts';
import { MarketDataGateway } from '../../lib/market-intelligence/providers/gateway.ts';
import { ProviderRegistry } from '../../lib/market-intelligence/providers/provider-registry.ts';
import { BALANCED_READINESS_POLICY } from '../../lib/market-intelligence/readiness/index.ts';
import { createDetectorRegistry } from '../../lib/market-intelligence/registry/bootstrap.ts';
import { DetectorRunner } from '../../lib/market-intelligence/runner/detector-runner.ts';
import { CompositionRuleRunner, createCompositionRuleRegistry } from '../../lib/market-intelligence/strategy-composition/index.ts';
import { stableFingerprint } from '../../lib/market-intelligence/serialization/stable-fingerprint.ts';
import { HistoricalDatasetManager, InMemoryHistoricalDatasetRepository } from '../../lib/market-intelligence-lab/historical-datasets/index.ts';
import { HistoricalReplayProviderFactory } from '../../lib/market-intelligence-lab/historical-replay/index.ts';
import { createValidationConfigurationHash, EXPLAINABILITY_FRAMEWORK_VERSION, VALIDATION_FRAMEWORK_VERSION, type ResearchArtifactProvenance } from '../../lib/market-intelligence-lab/reproducibility/index.ts';
import { createFirstExperimentStrategyRegistry } from '../../lib/market-intelligence-lab/strategy-registry/index.ts';

const EXPERIMENT_ID = (process.env.EXPERIMENT_ID ?? 'TP-EXP-2026-0001') as `TP-EXP-${number}-${number}`;
const DETECTOR_IDS = Object.freeze(['trend', 'retest', 'displacement']);
const OUTPUT_SIZE = 5_000;
const TIMEFRAME = 'M15';
const INTERVAL_MS = 15 * 60_000;
const executionTimestamp = new Date().toISOString();

async function fetchXauUsdUtc() {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) throw new Error('TWELVE_DATA_API_KEY is not configured.');
  const url = new URL('https://api.twelvedata.com/time_series');
  for (const [key, value] of Object.entries({ symbol: 'XAU/USD', interval: '15min', outputsize: String(OUTPUT_SIZE), order: 'ASC', timezone: 'UTC', apikey: apiKey })) url.searchParams.set(key, value);
  const response = await fetch(url, { cache: 'no-store' }), payload = await response.json();
  if (!response.ok || payload.status === 'error' || !Array.isArray(payload.values)) throw new Error(payload.message ?? 'Twelve Data historical request failed.');
  const cutoff = Date.parse(executionTimestamp);
  return Object.freeze(payload.values.map((row: Record<string, string>) => { const opened = Date.parse(`${row.datetime.replace(' ', 'T')}Z`); return Object.freeze({ openedAt: new Date(opened).toISOString(), closedAt: new Date(opened + INTERVAL_MS).toISOString(), open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close), volume: row.volume == null ? null : Number(row.volume), complete: true }); }).filter((candle: { closedAt: string }) => Date.parse(candle.closedAt) <= cutoff));
}

async function main() {
  const root = new URL(`../../research-artifacts/${EXPERIMENT_ID}/`, import.meta.url);
  try { await access(root, constants.F_OK); throw new Error(`${EXPERIMENT_ID} already exists and is immutable.`); } catch (error) { if (error instanceof Error && error.message.includes('already exists')) throw error; }
  const candles = process.env.SOURCE_DATASET_PATH ? Object.freeze(JSON.parse(await readFile(process.env.SOURCE_DATASET_PATH, 'utf8'))) : await fetchXauUsdUtc();
  const repository = new InMemoryHistoricalDatasetRepository(() => executionTimestamp), datasets = new HistoricalDatasetManager(repository);
  const imported = await datasets.importDataset({ name: 'XAUUSD M15 Twelve Data UTC first research sample', version: '1.0.0', instrument: 'XAUUSD', assetClass: 'METALS', timeframe: TIMEFRAME, provider: 'Twelve Data time_series timezone=UTC outputsize=5000', createdBy: 'trade-police-research', candles });
  await datasets.validate(imported.id); const certified = await datasets.certify(imported.id), dataset = await datasets.getDataset(imported.id);
  if (!dataset) throw new Error('Certified dataset could not be reloaded.');
  const replayProvider = await new HistoricalReplayProviderFactory(repository).create(certified.id), gateway = new MarketDataGateway(new ProviderRegistry().register(replayProvider).freeze());
  const strategies = createFirstExperimentStrategyRegistry(), strategy = strategies.require('gold-intraday-research', '1.0.0'), rules = createCompositionRuleRegistry(), detectors = createDetectorRegistry();
  const config = { readinessPolicy: BALANCED_READINESS_POLICY, decisionPolicy: STANDARD_ACTIONABILITY_POLICY, directionPolicy: DEFAULT_DIRECTION_POLICY };
  const adapter = new PipelineReplayAdapter({ dependencies: { runner: new DetectorRunner(detectors), contextBuilder: new AnalysisContextBuilder(), compositionRunner: new CompositionRuleRunner(rules) }, compiledStrategy: strategy, config, gateway, providerId: replayProvider.id });
  const protocol = Object.freeze({ ...DEFAULT_ENGINE_VALIDATION_PROTOCOL, seed: 123456 });
  const validationDataset: HistoricalValidationDataset = { id: certified.id, version: certified.version, instrument: certified.instrument, assetClass: certified.assetClass, timeframe: certified.timeframe, provider: certified.provider, contentHash: certified.contentHash, certificationStatus: 'CERTIFIED', candles: dataset.candles };
  const detectorVersions = Object.fromEntries(DETECTOR_IDS.map((id) => [id, detectors.get(id)!.version]));
  const provenance: ResearchArtifactProvenance = { provenanceVersion: '1.0.0', experimentId: EXPERIMENT_ID, datasetId: certified.id, datasetHash: certified.contentHash, datasetCertification: 'CERTIFIED', strategyId: strategy.id, strategyVersion: strategy.version, compiledStrategyId: strategy.compiledStrategyId, strategyDefinitionHash: strategies.definitionHash, strategyImmutable: true, pipelineVersion: '1.0.0', detectorVersions, decisionPolicyVersion: config.decisionPolicy.version, readinessPolicyVersion: config.readinessPolicy.version, directionPolicyVersion: config.directionPolicy.version, validationFrameworkVersion: VALIDATION_FRAMEWORK_VERSION, explainabilityFrameworkVersion: EXPLAINABILITY_FRAMEWORK_VERSION, gitCommitSha: process.env.GIT_COMMIT_SHA ?? '', randomSeed: protocol.seed, configurationHash: createValidationConfigurationHash(protocol, DETECTOR_IDS, strategy.compiledStrategyId), executionTimestamp, executionEnvironment: { runtime: 'node', runtimeVersion: process.version, operatingSystem: process.platform, architecture: process.arch, deployment: 'local-research', timezone: 'UTC' }, deterministicReplay: true, statisticalProtocolLocked: true };
  const report = await new EngineValidator(adapter).validate(validationDataset, DETECTOR_IDS, protocol, provenance);
  const experiment = Object.freeze({ experimentId: EXPERIMENT_ID, status: 'COMPLETED', hypothesis: 'Gold Intraday Research v1 readiness has measurable predictive value for long XAUUSD M15 opportunities over this certified sample.', datasetId: certified.id, datasetHash: certified.contentHash, strategyId: strategy.id, strategyVersion: strategy.version, strategyDefinitionHash: strategies.definitionHash, reportId: report.reportId, reportHash: stableFingerprint(report), conclusion: report.conclusion.verdict, reproducibilityScore: report.reproducibility.score, immutable: true });
  await mkdir(root, { recursive: true });
  await Promise.all([
    writeFile(new URL('dataset-manifest.json', root), `${JSON.stringify(certified, null, 2)}\n`, { flag: 'wx' }),
    writeFile(new URL('dataset-candles.json', root), `${JSON.stringify(dataset.candles)}\n`, { flag: 'wx' }),
    writeFile(new URL('experiment.json', root), `${JSON.stringify(experiment, null, 2)}\n`, { flag: 'wx' }),
    writeFile(new URL('report.json', root), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' }),
    writeFile(new URL('report.md', root), renderValidationReportMarkdown(report), { flag: 'wx' }),
  ]);
  console.log(JSON.stringify({ experimentId: EXPERIMENT_ID, datasetId: certified.id, candles: certified.candleCount, range: [certified.startAt, certified.endAt], reportId: report.reportId, reportHash: experiment.reportHash, conclusion: report.conclusion.verdict, reproducibilityScore: report.reproducibility.score, output: root.pathname }));
}

await main();
