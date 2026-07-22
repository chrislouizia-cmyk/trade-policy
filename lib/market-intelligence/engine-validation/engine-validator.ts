import { stableFingerprint } from '../serialization/stable-fingerprint.ts';
import { randomSelectionBaseline, smaBaseline } from './baselines.ts';
import { classificationMetrics, readinessBuckets, selectThreshold, thresholdCurve } from './metrics.ts';
import { bootstrapDifference, wilsonInterval } from './statistics.ts';
import { aggregateExplainability, extractOpportunityExplainability } from './explainability.ts';
import type { DetectorContribution, EngineValidationProtocol, EngineValidationReport, ExplainablePipelineReplayPort, FailureSegment, HistoricalValidationDataset, PipelineReplayPort, ValidationConclusion, ValidationOpportunity } from './validation-types.ts';
import { assessReproducibility, createValidationConfigurationHash } from '../../market-intelligence-lab/reproducibility/reproducibility.ts';
import type { ResearchArtifactProvenance } from '../../market-intelligence-lab/reproducibility/reproducibility-types.ts';
import { classifyLocalMarketRegime } from './local-regime.ts';

export const DEFAULT_ENGINE_VALIDATION_PROTOCOL: EngineValidationProtocol = Object.freeze({ version: '1.0.0', horizonCandles: 4, warmupCandles: 30, sampleStride: 4, minimumReturnBps: 2, confidenceLevel: .95, bootstrapIterations: 2_000, calibrationFraction: .7, readinessThresholds: Object.freeze(Array.from({ length: 21 }, (_, index) => index * 5)), minimumThresholdCoverage: .05, seed: 20260721 });

function validateDataset(dataset: HistoricalValidationDataset, protocol: EngineValidationProtocol): void {
  if (!dataset.id || !dataset.version || !dataset.instrument || !dataset.timeframe) throw new Error('Dataset identity is incomplete.');
  if (!Number.isInteger(protocol.horizonCandles) || protocol.horizonCandles < 1 || !Number.isInteger(protocol.warmupCandles) || protocol.warmupCandles < 24 || !Number.isInteger(protocol.sampleStride) || protocol.sampleStride < 1) throw new Error('Validation window settings are invalid.');
  if (protocol.calibrationFraction <= 0 || protocol.calibrationFraction >= 1) throw new Error('Calibration fraction must be between zero and one.');
  let previous = -Infinity;
  for (const candle of dataset.candles) {
    const opened = Date.parse(candle.openedAt), closed = Date.parse(candle.closedAt);
    if (!Number.isFinite(opened) || !Number.isFinite(closed) || opened <= previous || closed <= opened) throw new Error('Dataset timestamps must be valid and strictly ordered.');
    if (!candle.complete) throw new Error('Engine validation datasets may contain completed candles only.');
    if (![candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) || candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close) || candle.low > candle.high) throw new Error('Dataset contains malformed candle geometry.');
    previous = opened;
  }
  if (dataset.candles.length < protocol.warmupCandles + protocol.horizonCandles + 2) throw new Error('Dataset is too short for the validation protocol.');
}

function opportunity(result: Awaited<ReturnType<PipelineReplayPort['evaluate']>>, dataset: HistoricalValidationDataset, index: number, protocol: EngineValidationProtocol, timing: import('./explainability-types.ts').PipelineTimingTrace | null, counterfactualDirection: 'BUY' | 'SELL' | null): ValidationOpportunity {
  const horizon = protocol.horizonCandles;
  const current = dataset.candles[index]!, future = dataset.candles[index + horizon]!, forwardReturnBps = (future.close - current.close) / current.close * 10_000;
  const direction = result.directionAssessment?.direction ?? counterfactualDirection;
  const directionalReturnBps = direction === null ? null : forwardReturnBps * (direction === 'BUY' ? 1 : -1);
  const detectorStates: ValidationOpportunity['detectorStates'] = {};
  for (const detector of result.marketContext?.detectorResults ?? []) detectorStates[detector.detectorId] = detector.status;
  const localRegime = classifyLocalMarketRegime(dataset.candles.slice(index - protocol.warmupCandles + 1, index + 1));
  return Object.freeze({ id: `validation-opportunity:${stableFingerprint({ dataset: dataset.id, version: dataset.version, index, pipeline: result.pipelineResultId })}`, index, evaluatedAt: current.closedAt, entryPrice: current.close, exitPrice: future.close, forwardReturnBps, direction, directionalReturnBps, successful: directionalReturnBps === null ? null : directionalReturnBps > protocol.minimumReturnBps, readinessPercent: result.readinessAssessment?.confidencePercent ?? null, readinessStatus: result.readinessAssessment?.status ?? null, approved: result.decisionAssessment?.actionable === true && direction !== null, pipelineStatus: result.status, detectorStates, warnings: Object.freeze([...result.warnings]), localRegime, explainability: extractOpportunityExplainability(result, timing, counterfactualDirection, [`local-market:${localRegime.regime}`]) });
}

const rate = (rows: readonly ValidationOpportunity[]): number | null => { const selected = rows.filter((row) => row.approved && row.successful !== null); return selected.length ? selected.filter((row) => row.successful).length / selected.length : null; };

function conclusion(engineRows: readonly ValidationOpportunity[], engineMetrics: ReturnType<typeof classificationMetrics>, baselines: readonly { id: string; metrics: { successRate: { estimate: number } | null }; differenceInSuccessRate: { lower: number; upper: number } | null }[]): ValidationConclusion {
  const engineRate = rate(engineRows), random = baselines.find((item) => item.id === 'RANDOM_SELECTION'), simple = baselines.find((item) => item.id === 'SMA_10_24'), correlation = engineMetrics.readinessOutcomeCorrelation, auc = engineMetrics.readinessAuc, limitations = ['This is signal-level validation, not a realized-P&L backtest; no fill, stop, target, spread, slippage, commission, or position-sizing model is inferred.', 'Historical association does not demonstrate that the product causally improves human trader performance.', 'Detector leave-one-out results measure marginal pipeline impact and are not causal feature importance.'];
  if (engineRows.filter((row) => row.approved && row.successful !== null).length < 100) return { verdict: 'INCONCLUSIVE', statements: ['The holdout contains fewer than 100 approved, directionally evaluable opportunities. Predictive value cannot be demonstrated reliably.'], limitations };
  if (engineRate !== null && random?.metrics.successRate && simple?.metrics.successRate && random.differenceInSuccessRate?.lower! > 0 && simple.differenceInSuccessRate?.lower! > 0 && correlation?.lower! > 0 && auc?.lower! > .5) return { verdict: 'PREDICTIVE_VALUE_DEMONSTRATED', statements: [`The engine holdout success rate (${(engineRate * 100).toFixed(1)}%) exceeds both the coverage-matched random baseline (${(random.metrics.successRate.estimate * 100).toFixed(1)}%) and SMA(10/24) baseline (${(simple.metrics.successRate.estimate * 100).toFixed(1)}%); both advantage intervals exclude zero, Readiness correlation is positive, and Readiness AUC exceeds 0.5.`], limitations };
  if (random?.differenceInSuccessRate?.upper! <= 0 || auc?.upper! <= .5) return { verdict: 'NO_PREDICTIVE_VALUE_DEMONSTRATED', statements: ['The holdout evidence rejects a positive engine advantage over random selection or shows Readiness discrimination no better than chance.'], limitations };
  return { verdict: 'INCONCLUSIVE', statements: ['The holdout evidence does not simultaneously establish positive Readiness discrimination and superiority over both random selection and the simple SMA baseline at the configured confidence level.'], limitations };
}

export class EngineValidator {
  readonly #replay: PipelineReplayPort;
  constructor(replay: PipelineReplayPort) { this.#replay = replay; }

  async validate(dataset: HistoricalValidationDataset, detectorIds: readonly string[], protocol: EngineValidationProtocol, provenance: ResearchArtifactProvenance): Promise<EngineValidationReport> {
    validateDataset(dataset, protocol);
    const configurationHash = createValidationConfigurationHash(protocol, detectorIds, provenance.compiledStrategyId), reproducibility = assessReproducibility(provenance, { datasetId: dataset.id, datasetHash: dataset.contentHash, detectorIds, randomSeed: protocol.seed, configurationHash });
    if (!reproducibility.fullyReproducible) throw new Error(`Validation provenance is incomplete: ${reproducibility.issues.join(' ') || 'one or more reproducibility criteria failed.'}`);
    const full = await this.run(dataset, detectorIds, protocol), split = Math.max(1, Math.min(full.length - 1, Math.floor(full.length * protocol.calibrationFraction)));
    const calibrationRows = full.slice(0, split), holdoutRows = full.slice(split), calibrationCurve = thresholdCurve(calibrationRows, protocol), selectedThreshold = selectThreshold(calibrationCurve);
    const selected = selectedThreshold === null ? null : { threshold: selectedThreshold, metrics: classificationMetrics(holdoutRows, protocol, (row) => row.readinessPercent !== null && row.readinessPercent >= selectedThreshold), objective: null };
    const engineMetrics = classificationMetrics(holdoutRows, protocol), random = randomSelectionBaseline(holdoutRows, engineMetrics.coverage.estimate, protocol);
    const closeWindows = new Map(full.map((row) => [row.id, dataset.candles.slice(Math.max(0, row.index - protocol.warmupCandles + 1), row.index + 1).map((candle) => candle.close)]));
    const simple = smaBaseline(holdoutRows, closeWindows, protocol);
    const contributions: DetectorContribution[] = [];
    for (const detectorId of detectorIds) {
      const ablated = await this.run(dataset, detectorIds.filter((id) => id !== detectorId), protocol), ablatedHoldout = ablated.slice(split), fullRate = rate(holdoutRows), ablatedRate = rate(ablatedHoldout), fullCoverage = engineMetrics.coverage.estimate, ablatedCoverage = classificationMetrics(ablatedHoldout, protocol).coverage.estimate, delta = fullRate === null || ablatedRate === null ? null : fullRate - ablatedRate;
      const fullOutcomes = holdoutRows.filter((row) => row.approved && row.successful !== null).map((row) => row.successful ? 1 : 0), ablatedOutcomes = ablatedHoldout.filter((row) => row.approved && row.successful !== null).map((row) => row.successful ? 1 : 0), difference = bootstrapDifference(fullOutcomes, ablatedOutcomes, protocol.bootstrapIterations, protocol.seed + 1_000 + contributions.length, protocol.confidenceLevel);
      contributions.push({ detectorId, fullEngineSuccessRate: fullRate, ablatedSuccessRate: ablatedRate, successRateDelta: delta, successRateDifference: difference, fullEngineCoverage: fullCoverage, ablatedCoverage, coverageDelta: fullCoverage - ablatedCoverage, interpretation: !difference || difference.lower <= 0 && difference.upper >= 0 ? 'INCONCLUSIVE' : difference.lower > 0 ? 'CONTRIBUTES' : 'REDUCES_PERFORMANCE' });
    }
    const segmentKeys = new Set(holdoutRows.flatMap((row) => Object.entries(row.detectorStates).map(([id, status]) => `${id}:${status}`)));
    const failureSegments: FailureSegment[] = [...segmentKeys].map((key) => { const [id, status] = key.split(':'), population = holdoutRows.filter((row) => row.approved && row.detectorStates[id!] === status), failures = population.filter((row) => row.successful === false).length; return population.length ? { key, sampleSize: population.length, failures, failureRate: wilsonInterval(failures, population.length, protocol.confidenceLevel) } : null; }).filter((item): item is FailureSegment => item !== null).sort((a, b) => b.failureRate.estimate - a.failureRate.estimate || b.sampleSize - a.sampleSize).slice(0, 20);
    const missingDirection = full.filter((row) => row.direction === null).length, pipelineErrors = full.filter((row) => row.pipelineStatus === 'ERROR').length;
    const baselines = [random, simple];
    const contributionMap = new Map(contributions.map((item) => [item.detectorId, item.interpretation]));
    return Object.freeze({ reportVersion: '1.0.0', reportId: `engine-validation:${stableFingerprint({ dataset: dataset.id, version: dataset.version, protocol, detectorIds, provenance })}`, dataset: { id: dataset.id, version: dataset.version, instrument: dataset.instrument, assetClass: dataset.assetClass, timeframe: dataset.timeframe, provider: dataset.provider, contentHash: dataset.contentHash, certificationStatus: dataset.certificationStatus, candleCount: dataset.candles.length, startAt: dataset.candles[0]!.openedAt, endAt: dataset.candles.at(-1)!.closedAt }, protocol, detectorIds: Object.freeze([...detectorIds]), generatedAt: dataset.candles.at(-1)!.closedAt, calibration: { sampleSize: calibrationRows.length, thresholdCurve: calibrationCurve, selectedThreshold }, holdout: { sampleSize: holdoutRows.length, engine: engineMetrics, selectedThreshold: selected }, readinessBuckets: readinessBuckets(holdoutRows, protocol), baselines, detectorContributions: contributions, failureSegments, dataQuality: { totalCandidates: full.length, evaluated: full.length - pipelineErrors, missingDirection, pipelineErrors, warnings: Object.freeze([...new Set(full.flatMap((row) => row.warnings))]) }, conclusion: conclusion(holdoutRows, engineMetrics, baselines), explainability: aggregateExplainability(holdoutRows, detectorIds, protocol, contributionMap), provenance: Object.freeze(structuredClone(provenance)), reproducibility, });
  }

  private async run(dataset: HistoricalValidationDataset, detectorIds: readonly string[], protocol: EngineValidationProtocol): Promise<ValidationOpportunity[]> {
    const rows: ValidationOpportunity[] = [];
    for (let index = protocol.warmupCandles - 1; index + protocol.horizonCandles < dataset.candles.length; index += protocol.sampleStride) {
      const candles = dataset.candles.slice(index - protocol.warmupCandles + 1, index + 1), requestedAt = dataset.candles[index]!.closedAt;
      const input = { dataset, candles, requestedAt, detectorIds }, explainable = this.#replay as Partial<ExplainablePipelineReplayPort>;
      const evaluation = typeof explainable.evaluateWithTrace === 'function' ? await explainable.evaluateWithTrace(input) : { result: await this.#replay.evaluate(input), timing: null, counterfactualDirection: null };
      rows.push(opportunity(evaluation.result, dataset, index, protocol, evaluation.timing, evaluation.counterfactualDirection));
    }
    return rows;
  }
}
