import type { MarketDataSnapshot } from '../contracts.ts';
import { ConfidenceEngine } from '../confidence/confidence-engine.ts';
import { DecisionEngine } from '../decision/decision-engine.ts';
import { DirectionResolutionEngine } from '../direction/direction-resolution-engine.ts';
import type { DirectionPolicy } from '../direction/direction-types.ts';
import { EvidenceGraphBuilder } from '../evidence-graph/evidence-graph-builder.ts';
import { IntelligencePipelineOrchestrator, type IntelligencePipelineDependencies, type IntelligencePipelineConfig } from '../pipeline/index.ts';
import { ReadinessPolicyEngine } from '../readiness/readiness-policy-engine.ts';
import type { CompiledStrategyDefinition } from '../strategy-definitions/strategy-definition-types.ts';
import { stableFingerprint } from '../serialization/stable-fingerprint.ts';
import { timeframeDurationMs } from '../analysis-utils/timeframes.ts';
import type { PipelineReplayInput, ExplainablePipelineReplayPort } from './validation-types.ts';
import type { PipelineStageTiming, PipelineTimingTrace } from './explainability-types.ts';

export type PipelineReplayAdapterOptions = {
  dependencies: Omit<IntelligencePipelineDependencies, 'gateway'>;
  compiledStrategy: CompiledStrategyDefinition;
  config: IntelligencePipelineConfig;
  gateway?: IntelligencePipelineDependencies['gateway'];
  providerId?: string;
  now?: () => number;
};

/** Research-only adapter. It supplies immutable historical windows to the existing pipeline without changing production providers or routes. */
export class PipelineReplayAdapter implements ExplainablePipelineReplayPort {
  readonly #options: PipelineReplayAdapterOptions;
  constructor(options: PipelineReplayAdapterOptions) { this.#options = options; }

  evaluate(input: PipelineReplayInput) { return this.run(input, false).then((value) => value.result); }
  evaluateWithTrace(input: PipelineReplayInput) { return this.run(input, true); }

  private async run(input: PipelineReplayInput, collectTimings: boolean): Promise<{ result: Awaited<ReturnType<ExplainablePipelineReplayPort['evaluate']>>; timing: PipelineTimingTrace; counterfactualDirection: 'BUY' | 'SELL' | null }> {
    const now = this.#options.now ?? (() => globalThis.performance.now()), timings: PipelineStageTiming[] = [], totalStarted = now();
    const measured = <T>(stage: string, operation: () => T): T => { const started = now(); try { return operation(); } finally { if (collectTimings) timings.push({ stage, durationMs: Math.max(0, now() - started) }); } };
    const measuredAsync = async <T>(stage: string, operation: () => Promise<T>): Promise<T> => { const started = now(); try { return await operation(); } finally { if (collectTimings) timings.push({ stage, durationMs: Math.max(0, now() - started) }); } };
    const last = input.candles.at(-1)!;
    const replayCandles = input.candles.map((candle) => Object.freeze({ ...candle }));
    Object.freeze(replayCandles);
    const snapshot: MarketDataSnapshot = Object.freeze({
      id: `historical-snapshot:${stableFingerprint({ datasetId: input.dataset.id, datasetVersion: input.dataset.version, requestedAt: input.requestedAt, detectorIds: input.detectorIds })}`,
      snapshotVersion: '1.0.0', provider: `historical:${input.dataset.provider}`, providerVersion: input.dataset.version,
      providerSymbol: input.dataset.instrument, instrument: input.dataset.instrument, timeframe: input.dataset.timeframe,
      requestedAt: input.requestedAt, receivedAt: input.requestedAt, dataAsOf: last.closedAt,
      freshness: { state: 'FRESH' as const, dataAsOf: last.closedAt, ageMs: 0, maximumAgeMs: 0 },
      candles: replayCandles, validationWarnings: [],
    });
    const source = this.#options.dependencies, evidence = source.evidenceGraphBuilder ?? new EvidenceGraphBuilder(), confidence = source.confidenceEngine ?? new ConfidenceEngine(), readiness = source.readinessEngine ?? new ReadinessPolicyEngine(), decision = source.decisionEngine ?? new DecisionEngine(), direction = source.directionEngine ?? new DirectionResolutionEngine();
    const orchestrator = new IntelligencePipelineOrchestrator({
      gateway: { fetchSnapshot: (...args) => measuredAsync('MARKET_DATA', () => this.#options.gateway ? this.#options.gateway.fetchSnapshot(...args) : Promise.resolve(snapshot)) },
      runner: { execute: (...args) => measuredAsync('DETECTORS', () => source.runner.execute(...args)) },
      contextBuilder: { build: (...args) => measured('MARKET_CONTEXT', () => source.contextBuilder.build(...args)) },
      compositionRunner: { execute: (...args) => measured('STRATEGY_COMPOSITION', () => source.compositionRunner.execute(...args)) },
      evidenceGraphBuilder: { build: (...args) => measured('EVIDENCE_GRAPH', () => evidence.build(...args)) },
      confidenceEngine: { assess: (...args) => measured('CONFIDENCE', () => confidence.assess(...args)) },
      readinessEngine: { assess: (...args) => measured('READINESS', () => readiness.assess(...args)) },
      decisionEngine: { assess: (...args) => measured('DECISION', () => decision.assess(...args)) },
      directionEngine: { assess: (...args) => measured('DIRECTION', () => direction.assess(...args)) },
    });
    const result = await orchestrator.execute({ marketDataRequest: { instrument: input.dataset.instrument, timeframe: input.dataset.timeframe, candleCount: input.candles.length, includeCurrentPrice: false, includeSpread: false, allowCached: false, maximumDataAge: timeframeDurationMs(input.dataset.timeframe) ?? 0, requestedAt: input.requestedAt }, providerId: this.#options.providerId ?? snapshot.provider, detectorIds: input.detectorIds, assetClass: input.dataset.assetClass, compiledStrategy: this.#options.compiledStrategy }, this.#options.config);
    const totalDurationMs = Math.max(0, now() - totalStarted);
    let counterfactualDirection = result.directionAssessment?.direction ?? null;
    if (counterfactualDirection === null && this.#options.compiledStrategy.directionConfiguration?.mode === 'FIXED') counterfactualDirection = this.#options.compiledStrategy.directionConfiguration.fixedDirection ?? null;
    if (counterfactualDirection === null && result.decisionAssessment?.outcome === 'NO_ACTION' && result.strategyContext && result.evidenceGraph && result.confidenceAssessment && result.readinessAssessment) {
      const policy: DirectionPolicy = { ...this.#options.config.directionPolicy, id: `${this.#options.config.directionPolicy.id}-validation-diagnostic`, requireActionableDecision: false, allowedDecisionOutcomes: ['ACTIONABLE', 'NO_ACTION'], metadata: { ...this.#options.config.directionPolicy.metadata, diagnostic: true } };
      counterfactualDirection = direction.assess(this.#options.compiledStrategy, result.strategyContext, result.evidenceGraph, result.confidenceAssessment, result.readinessAssessment, result.decisionAssessment, policy).direction;
    }
    return { result, timing: Object.freeze({ totalDurationMs, stages: Object.freeze(timings), diagnosticOnly: true }), counterfactualDirection };
  }
}
