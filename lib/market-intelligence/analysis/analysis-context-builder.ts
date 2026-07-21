import type {
  ContextConflict,
  DataFreshness,
  DetectorResult,
  MarketContext,
  MarketDataSnapshot,
} from '../contracts.ts';
import type { DetectorRunSummary } from '../types/detector.ts';

type ContextBuilderOptions = {
  now?: () => string;
  createContextId?: (snapshot: MarketDataSnapshot, summary: DetectorRunSummary) => string;
};

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];
const evidenceIds = (results: readonly DetectorResult[]) => unique(results.flatMap((result) => result.evidence.map((item) => item.id)));
const conflictId = (type: string, values: readonly string[]) => `conflict:${type.toLowerCase()}:${values.join(':')}`;

function overallFreshness(snapshot: MarketDataSnapshot, results: readonly DetectorResult[]): DataFreshness['state'] {
  const states = [snapshot.freshness.state, ...results.map((result) => result.freshness.state)];
  if (states.includes('STALE')) return 'STALE';
  if (states.includes('UNKNOWN')) return 'UNKNOWN';
  return 'FRESH';
}

function aggregateConfidence(results: readonly DetectorResult[]): number | null {
  const values = results.flatMap((result) => result.confidence === null ? [] : [result.confidence]);
  return values.length ? Math.round((values.reduce((total, value) => total + value, 0) / values.length) * 100) / 100 : null;
}

function deriveConflicts(snapshot: MarketDataSnapshot, summary: DetectorRunSummary): ContextConflict[] {
  const conflicts: ContextConflict[] = [];
  if (snapshot.freshness.state === 'STALE') {
    conflicts.push({
      id: conflictId('STALE_DATA', [snapshot.id]), type: 'STALE_DATA',
      description: `Snapshot ${snapshot.id} is stale.`, detectorIds: [], timeframes: [snapshot.timeframe], evidenceIds: [], severity: 'WARNING',
    });
  }

  for (const failure of summary.detectorFailures) {
    const missing = failure.errorCode === 'DETECTOR_NOT_REGISTERED';
    const result = summary.detectorResults.find((item) => item.detectorId === failure.detectorId);
    conflicts.push({
      id: conflictId(missing ? 'MISSING_REQUIRED_DETECTOR' : 'DETECTOR_FAILURE', [failure.detectorId]),
      type: missing ? 'MISSING_REQUIRED_DETECTOR' : 'DETECTOR_FAILURE',
      description: failure.message,
      detectorIds: [failure.detectorId],
      timeframes: result ? [result.timeframe] : [],
      evidenceIds: result ? evidenceIds([result]) : [],
      severity: 'ERROR',
    });
  }

  const byDetector = new Map<string, DetectorResult[]>();
  for (const result of summary.detectorResults) byDetector.set(result.detectorId, [...(byDetector.get(result.detectorId) ?? []), result]);
  for (const [detectorId, results] of byDetector) {
    const timeframes = unique(results.map((result) => result.timeframe));
    const observations = unique(results.map((result) => JSON.stringify({ status: result.status, payload: result.payload })));
    if (timeframes.length > 1 && observations.length > 1) {
      conflicts.push({
        id: conflictId('TIMEFRAME_DISAGREEMENT', [detectorId, ...timeframes]), type: 'TIMEFRAME_DISAGREEMENT',
        description: `${detectorId} produced different observations across timeframes.`, detectorIds: [detectorId], timeframes,
        evidenceIds: evidenceIds(results), severity: 'WARNING',
      });
    }
    const byTimeframe = new Map<string, DetectorResult[]>();
    for (const result of results) byTimeframe.set(result.timeframe, [...(byTimeframe.get(result.timeframe) ?? []), result]);
    for (const [timeframe, sameFrame] of byTimeframe) {
      const distinct = unique(sameFrame.map((result) => JSON.stringify({ status: result.status, payload: result.payload })));
      if (sameFrame.length > 1 && distinct.length > 1) conflicts.push({
        id: conflictId('DETECTOR_DISAGREEMENT', [detectorId, timeframe]), type: 'DETECTOR_DISAGREEMENT',
        description: `${detectorId} produced conflicting observations for ${timeframe}.`, detectorIds: [detectorId], timeframes: [timeframe],
        evidenceIds: evidenceIds(sameFrame), severity: 'WARNING',
      });
    }
  }
  return conflicts;
}

function freezeContext(context: MarketContext): MarketContext {
  Object.freeze(context.timeframes);
  Object.freeze(context.detectorResults);
  Object.values(context.detectorResultsByTimeframe).forEach(Object.freeze);
  Object.freeze(context.detectorResultsByTimeframe);
  Object.freeze(context.warnings);
  context.conflicts.forEach((conflict) => {
    Object.freeze(conflict.detectorIds); Object.freeze(conflict.timeframes); Object.freeze(conflict.evidenceIds); Object.freeze(conflict);
  });
  Object.freeze(context.conflicts);
  return Object.freeze(context);
}

export class AnalysisContextBuilder {
  readonly #now?: () => string;
  readonly #createContextId: (snapshot: MarketDataSnapshot, summary: DetectorRunSummary) => string;

  constructor(options: ContextBuilderOptions = {}) {
    this.#now = options.now;
    this.#createContextId = options.createContextId ?? ((snapshot, summary) => `context:${snapshot.id}:${summary.runId}`);
  }

  build(snapshot: MarketDataSnapshot, summary: DetectorRunSummary): MarketContext {
    const results = [...summary.detectorResults];
    const detectorResultsByTimeframe: Record<string, DetectorResult[]> = {};
    for (const result of results) detectorResultsByTimeframe[result.timeframe] = [...(detectorResultsByTimeframe[result.timeframe] ?? []), result];
    const warnings = unique([
      ...snapshot.validationWarnings,
      ...results.flatMap((result) => result.warnings),
      ...summary.detectorFailures.map((failure) => failure.message),
    ]);
    return freezeContext({
      contextId: this.#createContextId(snapshot, summary), contextVersion: '1.0.0', instrument: snapshot.instrument,
      provider: snapshot.provider, providerVersion: snapshot.providerVersion,
      timeframes: unique([snapshot.timeframe, ...results.map((result) => result.timeframe).filter((timeframe) => timeframe !== 'GLOBAL')]),
      snapshotId: snapshot.id, snapshotVersion: snapshot.snapshotVersion, snapshotFreshness: snapshot.freshness,
      detectorRunId: summary.runId, detectorResults: results, detectorResultsByTimeframe, warnings, conflicts: deriveConflicts(snapshot, summary),
      overallFreshness: overallFreshness(snapshot, results), overallConfidence: aggregateConfidence(results),
      dataAsOf: snapshot.dataAsOf, requestedAt: snapshot.requestedAt, generatedAt: this.#now?.() ?? snapshot.requestedAt,
    });
  }
}
