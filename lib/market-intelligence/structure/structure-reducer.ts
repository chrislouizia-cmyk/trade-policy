import { canonicalStringify, stableFingerprint } from '../serialization/stable-fingerprint.ts';
import type { ConfirmedSwing, SwingDirection } from '../detectors/confirmed-swing/confirmed-swing-types.ts';
import type { ClassifiedSwing, IncrementalStructureReducer, OutsideCandlePolicy, StructureBias, StructureReducerConfig, StructureSnapshot, StructureStateResult, SwingStructureLabel } from './structure-types.ts';

export const MARKET_STRUCTURE_REDUCER_VERSION = '1.0.0';
export const DEFAULT_STRUCTURE_REDUCER_CONFIG: StructureReducerConfig = Object.freeze({
  equalityToleranceAbsolute: 0,
  equalityToleranceRelative: 0,
  minimumSwingSeparationBars: 0,
  sameDirectionReplacementPolicy: 'KEEP_ALL',
  outsideCandlePolicy: 'PROCESS_HIGH_THEN_LOW',
});

export class StructureReducerError extends Error {
  readonly code: 'INVALID_CONFIGURATION' | 'INVALID_SWING' | 'DUPLICATE_SWING_ID' | 'OUT_OF_ORDER_INCREMENTAL_SWING';
  constructor(code: StructureReducerError['code'], message: string) {
    super(message);
    this.name = 'StructureReducerError';
    this.code = code;
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function normalizeConfig(input: Partial<StructureReducerConfig> = {}): StructureReducerConfig {
  const configuration: StructureReducerConfig = {
    equalityToleranceAbsolute: input.equalityToleranceAbsolute ?? DEFAULT_STRUCTURE_REDUCER_CONFIG.equalityToleranceAbsolute,
    equalityToleranceRelative: input.equalityToleranceRelative ?? DEFAULT_STRUCTURE_REDUCER_CONFIG.equalityToleranceRelative,
    minimumSwingSeparationBars: input.minimumSwingSeparationBars ?? DEFAULT_STRUCTURE_REDUCER_CONFIG.minimumSwingSeparationBars,
    sameDirectionReplacementPolicy: input.sameDirectionReplacementPolicy ?? DEFAULT_STRUCTURE_REDUCER_CONFIG.sameDirectionReplacementPolicy,
    outsideCandlePolicy: input.outsideCandlePolicy ?? DEFAULT_STRUCTURE_REDUCER_CONFIG.outsideCandlePolicy,
  };
  if (!Number.isFinite(configuration.equalityToleranceAbsolute) || configuration.equalityToleranceAbsolute < 0) throw new StructureReducerError('INVALID_CONFIGURATION', 'equalityToleranceAbsolute must be non-negative and finite.');
  if (!Number.isFinite(configuration.equalityToleranceRelative) || configuration.equalityToleranceRelative < 0) throw new StructureReducerError('INVALID_CONFIGURATION', 'equalityToleranceRelative must be non-negative and finite.');
  if (!Number.isInteger(configuration.minimumSwingSeparationBars) || configuration.minimumSwingSeparationBars < 0) throw new StructureReducerError('INVALID_CONFIGURATION', 'minimumSwingSeparationBars must be a non-negative integer.');
  if (!['KEEP_FIRST', 'KEEP_EXTREME', 'KEEP_ALL'].includes(configuration.sameDirectionReplacementPolicy)) throw new StructureReducerError('INVALID_CONFIGURATION', 'Unknown same-direction replacement policy.');
  if (!['PROCESS_HIGH_THEN_LOW', 'PROCESS_LOW_THEN_HIGH', 'REJECT_AMBIGUOUS'].includes(configuration.outsideCandlePolicy)) throw new StructureReducerError('INVALID_CONFIGURATION', 'Unknown outside-candle policy.');
  return deepFreeze(configuration);
}

function validateSwing(swing: ConfirmedSwing): void {
  if (!swing || typeof swing !== 'object' || !swing.id) throw new StructureReducerError('INVALID_SWING', 'Every confirmed swing requires a stable ID.');
  if (!['HIGH', 'LOW'].includes(swing.direction)) throw new StructureReducerError('INVALID_SWING', `Unknown swing direction: ${String(swing.direction)}.`);
  const pivotAt = Date.parse(swing.pivotAt);
  const confirmedAt = Date.parse(swing.confirmedAt);
  if (!Number.isFinite(pivotAt) || !Number.isFinite(confirmedAt)) throw new StructureReducerError('INVALID_SWING', 'pivotAt and confirmedAt must be valid timestamps.');
  if (confirmedAt < pivotAt) throw new StructureReducerError('INVALID_SWING', 'confirmedAt cannot be earlier than pivotAt.');
  if (!Number.isFinite(swing.price) || swing.price <= 0) throw new StructureReducerError('INVALID_SWING', 'Swing price must be a positive finite number.');
  if (!Number.isInteger(swing.pivotIndex) || !Number.isInteger(swing.confirmedIndex) || swing.pivotIndex < 0 || swing.confirmedIndex < swing.pivotIndex) throw new StructureReducerError('INVALID_SWING', 'Swing indices must be chronological non-negative integers.');
}

function directionOrder(direction: SwingDirection, policy: OutsideCandlePolicy): number {
  if (policy === 'PROCESS_LOW_THEN_HIGH') return direction === 'LOW' ? 0 : 1;
  return direction === 'HIGH' ? 0 : 1;
}

function normalizedSwings(swings: readonly ConfirmedSwing[], configuration: StructureReducerConfig): ConfirmedSwing[] {
  const ids = new Set<string>();
  for (const swing of swings) {
    validateSwing(swing);
    if (ids.has(swing.id)) throw new StructureReducerError('DUPLICATE_SWING_ID', `Duplicate swing ID: ${swing.id}.`);
    ids.add(swing.id);
  }
  return [...swings].sort((left, right) => {
    const time = Date.parse(left.confirmedAt) - Date.parse(right.confirmedAt);
    if (time) return time;
    const sameOutsidePivot = left.pivotAt === right.pivotAt && left.confirmedAt === right.confirmedAt && left.direction !== right.direction;
    if (sameOutsidePivot) return directionOrder(left.direction, configuration.outsideCandlePolicy) - directionOrder(right.direction, configuration.outsideCandlePolicy);
    return left.id.localeCompare(right.id);
  });
}

export function equalityTolerance(left: number, right: number, configuration: StructureReducerConfig): number {
  return Math.max(configuration.equalityToleranceAbsolute, Math.max(Math.abs(left), Math.abs(right)) * configuration.equalityToleranceRelative);
}

function labelSwing(swing: ConfirmedSwing, previous: ClassifiedSwing | null, configuration: StructureReducerConfig): { label: SwingStructureLabel; delta: number } {
  if (!previous) return { label: swing.direction === 'HIGH' ? 'INITIAL_HIGH' : 'INITIAL_LOW', delta: 0 };
  const delta = swing.price - previous.swing.price;
  const equal = Math.abs(delta) <= equalityTolerance(swing.price, previous.swing.price, configuration);
  if (swing.direction === 'HIGH') return { label: equal ? 'EH' : delta > 0 ? 'HH' : 'LH', delta };
  return { label: equal ? 'EL' : delta > 0 ? 'HL' : 'LL', delta };
}

function biasFor(high: ClassifiedSwing | null, low: ClassifiedSwing | null): StructureBias {
  if (!high || !low || high.label === 'INITIAL_HIGH' || low.label === 'INITIAL_LOW') return 'UNDEFINED';
  if (high.label === 'HH' && low.label === 'HL') return 'BULLISH';
  if (high.label === 'LH' && low.label === 'LL') return 'BEARISH';
  return 'MIXED';
}

function classifiedIdentity(swing: ConfirmedSwing, label: SwingStructureLabel, previousComparableSwingId: string | null, comparisonDelta: number, accepted: boolean, rejectionReason: string | null, replacementOfSwingId: string | null, configuration: StructureReducerConfig): string {
  return `classified-swing:${stableFingerprint({ reducerVersion: MARKET_STRUCTURE_REDUCER_VERSION, swingId: swing.id, label, previousComparableSwingId, comparisonDelta, accepted, rejectionReason, replacementOfSwingId, processedAt: swing.confirmedAt, configuration })}`;
}

function classification(swing: ConfirmedSwing, label: SwingStructureLabel, previous: ClassifiedSwing | null, delta: number, accepted: boolean, rejectionReason: string | null, replacementOfSwingId: string | null, configuration: StructureReducerConfig): ClassifiedSwing {
  const previousComparableSwingId = previous?.swing.id ?? null;
  return deepFreeze({
    id: classifiedIdentity(swing, label, previousComparableSwingId, delta, accepted, rejectionReason, replacementOfSwingId, configuration),
    swing: deepFreeze(structuredClone(swing)),
    label,
    previousComparableSwingId,
    comparisonDelta: delta,
    accepted,
    rejectionReason,
    replacementOfSwingId,
    processedAt: swing.confirmedAt,
  });
}

function comparisonEvidence(classified: ClassifiedSwing | null): string | null {
  if (!classified) return null;
  if (!classified.previousComparableSwingId) return `${classified.swing.direction === 'HIGH' ? 'First high' : 'First low'} classified ${classified.label} at ${classified.swing.price}.`;
  const operator = classified.label === 'HH' || classified.label === 'HL' ? '>' : classified.label === 'LH' || classified.label === 'LL' ? '<' : '=';
  const previousPrice = classified.swing.price - classified.comparisonDelta;
  return `Latest ${classified.swing.direction.toLowerCase()} classified ${classified.label}: ${classified.swing.price} ${operator} ${previousPrice}.`;
}

function biasEvidence(bias: StructureBias, high: ClassifiedSwing | null, low: ClassifiedSwing | null): string {
  if (bias === 'BULLISH') return 'Bias BULLISH because latest comparable structure is HH + HL.';
  if (bias === 'BEARISH') return 'Bias BEARISH because latest comparable structure is LH + LL.';
  if (bias === 'UNDEFINED') return 'Bias UNDEFINED because comparable confirmed highs and lows are not both available.';
  return `Bias MIXED because latest comparable labels are ${high?.label ?? 'NONE'} + ${low?.label ?? 'NONE'}.`;
}

function snapshot(processedAt: string | null, lastHigh: ClassifiedSwing | null, lastLow: ClassifiedSwing | null, previousHigh: ClassifiedSwing | null, previousLow: ClassifiedSwing | null, sourceSwingIds: readonly string[], configuration: StructureReducerConfig): StructureSnapshot {
  const bias = biasFor(lastHigh, lastLow);
  const evidence = [comparisonEvidence(lastHigh), comparisonEvidence(lastLow), biasEvidence(bias, lastHigh, lastLow)].filter((value): value is string => value !== null);
  const identity = { reducerVersion: MARKET_STRUCTURE_REDUCER_VERSION, processedAt, lastHighId: lastHigh?.id ?? null, lastLowId: lastLow?.id ?? null, previousHighId: previousHigh?.id ?? null, previousLowId: previousLow?.id ?? null, bias, evidence, sourceSwingIds, configuration };
  return deepFreeze({
    id: `structure-snapshot:${stableFingerprint(identity)}`,
    processedAt,
    lastConfirmedHigh: lastHigh,
    lastConfirmedLow: lastLow,
    previousConfirmedHigh: previousHigh,
    previousConfirmedLow: previousLow,
    latestHighLabel: lastHigh?.label ?? null,
    latestLowLabel: lastLow?.label ?? null,
    bias,
    evidence,
    sourceSwingIds: [...sourceSwingIds],
  });
}

function ambiguousOutsideIds(swings: readonly ConfirmedSwing[], configuration: StructureReducerConfig): Set<string> {
  if (configuration.outsideCandlePolicy !== 'REJECT_AMBIGUOUS') return new Set();
  const groups = new Map<string, ConfirmedSwing[]>();
  for (const swing of swings) {
    const key = `${swing.pivotAt}|${swing.confirmedAt}`;
    groups.set(key, [...(groups.get(key) ?? []), swing]);
  }
  return new Set([...groups.values()].filter((group) => new Set(group.map((swing) => swing.direction)).size > 1).flatMap((group) => group.map((swing) => swing.id)));
}

export function reduceMarketStructure(swings: readonly ConfirmedSwing[], input: Partial<StructureReducerConfig> = {}): StructureStateResult {
  const configuration = normalizeConfig(input);
  const ordered = normalizedSwings(swings, configuration);
  const ambiguousIds = ambiguousOutsideIds(ordered, configuration);
  const classifiedSwings: ClassifiedSwing[] = [];
  const snapshots: StructureSnapshot[] = [];
  const warnings: string[] = [];
  const logical = new Set<string>();
  const acceptedIds: string[] = [];
  let lastHigh: ClassifiedSwing | null = null;
  let previousHigh: ClassifiedSwing | null = null;
  let lastLow: ClassifiedSwing | null = null;
  let previousLow: ClassifiedSwing | null = null;
  let lastAcceptedOverall: ClassifiedSwing | null = null;

  for (const swing of ordered) {
    const previous = swing.direction === 'HIGH' ? lastHigh : lastLow;
    const labelled = labelSwing(swing, previous, configuration);
    const logicalKey = `${swing.direction}|${swing.pivotAt}|${swing.price}`;
    const lastOverall = lastAcceptedOverall as ClassifiedSwing | null;
    let rejectionReason: string | null = null;
    let replacementOfSwingId: string | null = null;
    if (ambiguousIds.has(swing.id)) rejectionReason = 'AMBIGUOUS_OUTSIDE_CANDLE_REJECTED';
    else if (logical.has(logicalKey)) {
      rejectionReason = 'DUPLICATE_LOGICAL_SWING';
      warnings.push(`Duplicate logical ${swing.direction} pivot at ${swing.pivotAt} and price ${swing.price} was rejected.`);
    } else if (previous && Math.abs(swing.pivotIndex - previous.swing.pivotIndex) < configuration.minimumSwingSeparationBars) rejectionReason = `MINIMUM_SWING_SEPARATION_${configuration.minimumSwingSeparationBars}_BARS`;
    else if (lastOverall?.swing.direction === swing.direction && configuration.sameDirectionReplacementPolicy === 'KEEP_FIRST') rejectionReason = 'CONSECUTIVE_SAME_DIRECTION_KEEP_FIRST';
    else if (lastOverall?.swing.direction === swing.direction && configuration.sameDirectionReplacementPolicy === 'KEEP_EXTREME') {
      const moreExtreme = swing.direction === 'HIGH' ? swing.price > lastOverall.swing.price : swing.price < lastOverall.swing.price;
      if (moreExtreme) replacementOfSwingId = lastOverall.swing.id;
      else rejectionReason = 'CONSECUTIVE_SAME_DIRECTION_NOT_MORE_EXTREME';
    }
    logical.add(logicalKey);
    const accepted = rejectionReason === null;
    const classified = classification(swing, labelled.label, previous, labelled.delta, accepted, rejectionReason, replacementOfSwingId, configuration);
    classifiedSwings.push(classified);
    if (!accepted) {
      if (rejectionReason === 'AMBIGUOUS_OUTSIDE_CANDLE_REJECTED') warnings.push(`Ambiguous outside-candle swing ${swing.id} was rejected by policy.`);
      continue;
    }
    if (swing.direction === 'HIGH') {
      previousHigh = lastHigh;
      lastHigh = classified;
    } else {
      previousLow = lastLow;
      lastLow = classified;
    }
    lastAcceptedOverall = classified;
    acceptedIds.push(swing.id);
    snapshots.push(snapshot(swing.confirmedAt, lastHigh, lastLow, previousHigh, previousLow, acceptedIds, configuration));
  }
  const finalSnapshot = snapshots.at(-1) ?? snapshot(null, null, null, null, null, [], configuration);
  return deepFreeze({ reducerVersion: MARKET_STRUCTURE_REDUCER_VERSION, classifiedSwings, snapshots, finalSnapshot, warnings, configuration });
}

export function createStructureReducer(input: Partial<StructureReducerConfig> = {}): IncrementalStructureReducer {
  const configuration = normalizeConfig(input);
  const swings: ConfirmedSwing[] = [];
  let result = reduceMarketStructure([], configuration);
  let newlyClassified: ClassifiedSwing[] = [];
  const api: IncrementalStructureReducer = {
    pushSwing(swing) {
      validateSwing(swing);
      if (swings.some((existing) => existing.id === swing.id)) throw new StructureReducerError('DUPLICATE_SWING_ID', `Duplicate swing ID: ${swing.id}.`);
      const lastConfirmedAt = swings.at(-1)?.confirmedAt;
      if (lastConfirmedAt && Date.parse(swing.confirmedAt) < Date.parse(lastConfirmedAt)) throw new StructureReducerError('OUT_OF_ORDER_INCREMENTAL_SWING', `Incremental confirmedAt ${swing.confirmedAt} is earlier than ${lastConfirmedAt}.`);
      swings.push(deepFreeze(structuredClone(swing)));
      const previousClassifications = new Map(result.classifiedSwings.map((classified) => [classified.swing.id, classified.id]));
      result = reduceMarketStructure(swings, configuration);
      newlyClassified = result.classifiedSwings.filter((classified) => previousClassifications.get(classified.swing.id) !== classified.id);
      return deepFreeze([...newlyClassified]);
    },
    getNewClassifications() {
      const next = deepFreeze([...newlyClassified]);
      newlyClassified = [];
      return next;
    },
    getCurrentSnapshot() { return result.finalSnapshot; },
    getAllClassifiedSwings() { return deepFreeze([...result.classifiedSwings]); },
    getSnapshots() { return deepFreeze([...result.snapshots]); },
    getWarnings() { return deepFreeze([...result.warnings]); },
    getResult() { return result; },
    reset() {
      swings.length = 0;
      newlyClassified = [];
      result = reduceMarketStructure([], configuration);
    },
  };
  return Object.freeze(api);
}

export function serializeStructureState(result: StructureStateResult): string {
  return canonicalStringify(result);
}
