import { validateCandles } from '../../analysis-utils/index.ts';
import type { NormalizedCandle } from '../../contracts.ts';
import type { ConfirmedSwing } from '../../detectors/confirmed-swing/confirmed-swing-types.ts';
import { canonicalStringify, stableFingerprint } from '../../serialization/stable-fingerprint.ts';
import type { ClassifiedSwing, StructureSnapshot, SwingStructureLabel } from '../structure-types.ts';
import type { BreakOfStructureConfig, BreakOfStructureDetectionInput, BreakOfStructureDetectionResult, BreakOfStructureDirection, BreakOfStructureEvent, ContinuationContext, IncrementalBreakOfStructureDetector } from './break-of-structure-types.ts';

export const CONFIRMED_STRUCTURE_BOS_VERSION = '1.0.0';
const HIGH_LABELS: SwingStructureLabel[] = ['INITIAL_HIGH', 'HH', 'LH', 'EH'];
const LOW_LABELS: SwingStructureLabel[] = ['INITIAL_LOW', 'HL', 'LL', 'EL'];

export const DEFAULT_BREAK_OF_STRUCTURE_CONFIG: BreakOfStructureConfig = Object.freeze({
  closeToleranceAbsolute: 0,
  closeToleranceRelative: 0,
  swingEligibility: 'LATEST_ACCEPTED_STRUCTURE',
  requireDirectionalBias: 'NONE',
  sourceSwingLabels: Object.freeze({ bullish: Object.freeze([...HIGH_LABELS]), bearish: Object.freeze([...LOW_LABELS]) }),
  duplicateBreakPolicy: 'EMIT_ONCE_PER_SWING',
  gapBreakPolicy: 'ALLOW',
}) as BreakOfStructureConfig;

export class BreakOfStructureDetectionError extends Error {
  readonly code: 'INVALID_CONFIGURATION' | 'INVALID_CANDLES' | 'INVALID_SWING' | 'INVALID_SNAPSHOT' | 'DUPLICATE_SWING_ID' | 'DUPLICATE_CANDLE' | 'DUPLICATE_SNAPSHOT_ID' | 'OUT_OF_ORDER_INCREMENTAL_INPUT' | 'LATE_INCREMENTAL_INFORMATION';
  constructor(code: BreakOfStructureDetectionError['code'], message: string) {
    super(message);
    this.name = 'BreakOfStructureDetectionError';
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

function normalizeConfig(input: Partial<BreakOfStructureConfig> = {}): BreakOfStructureConfig {
  const sourceSwingLabels = {
    bullish: [...(input.sourceSwingLabels?.bullish ?? DEFAULT_BREAK_OF_STRUCTURE_CONFIG.sourceSwingLabels.bullish)],
    bearish: [...(input.sourceSwingLabels?.bearish ?? DEFAULT_BREAK_OF_STRUCTURE_CONFIG.sourceSwingLabels.bearish)],
  };
  const configuration: BreakOfStructureConfig = {
    closeToleranceAbsolute: input.closeToleranceAbsolute ?? 0,
    closeToleranceRelative: input.closeToleranceRelative ?? 0,
    swingEligibility: input.swingEligibility ?? 'LATEST_ACCEPTED_STRUCTURE',
    requireDirectionalBias: input.requireDirectionalBias ?? 'NONE',
    sourceSwingLabels,
    duplicateBreakPolicy: input.duplicateBreakPolicy ?? 'EMIT_ONCE_PER_SWING',
    gapBreakPolicy: input.gapBreakPolicy ?? 'ALLOW',
  };
  if (!Number.isFinite(configuration.closeToleranceAbsolute) || configuration.closeToleranceAbsolute < 0) throw new BreakOfStructureDetectionError('INVALID_CONFIGURATION', 'closeToleranceAbsolute must be non-negative and finite.');
  if (!Number.isFinite(configuration.closeToleranceRelative) || configuration.closeToleranceRelative < 0) throw new BreakOfStructureDetectionError('INVALID_CONFIGURATION', 'closeToleranceRelative must be non-negative and finite.');
  if (!['LATEST_CONFIRMED', 'LATEST_ACCEPTED_STRUCTURE', 'ALL_UNBROKEN_ACCEPTED'].includes(configuration.swingEligibility)) throw new BreakOfStructureDetectionError('INVALID_CONFIGURATION', 'Unknown swing eligibility policy.');
  if (!['NONE', 'CONTINUATION_ONLY'].includes(configuration.requireDirectionalBias)) throw new BreakOfStructureDetectionError('INVALID_CONFIGURATION', 'Unknown directional-bias requirement.');
  if (!['EMIT_ONCE_PER_SWING', 'ALLOW_REBREAK_AFTER_CLOSE_BACK_INSIDE'].includes(configuration.duplicateBreakPolicy)) throw new BreakOfStructureDetectionError('INVALID_CONFIGURATION', 'Unknown duplicate-break policy.');
  if (!['ALLOW', 'REJECT'].includes(configuration.gapBreakPolicy)) throw new BreakOfStructureDetectionError('INVALID_CONFIGURATION', 'Unknown gap-break policy.');
  if (sourceSwingLabels.bullish.some((label) => !HIGH_LABELS.includes(label)) || sourceSwingLabels.bearish.some((label) => !LOW_LABELS.includes(label))) throw new BreakOfStructureDetectionError('INVALID_CONFIGURATION', 'Source swing labels must match their structural direction.');
  return deepFreeze(configuration);
}

function validateSwing(swing: ConfirmedSwing): void {
  if (!swing.id || !['HIGH', 'LOW'].includes(swing.direction)) throw new BreakOfStructureDetectionError('INVALID_SWING', 'Confirmed swing identity or direction is invalid.');
  const pivot = Date.parse(swing.pivotAt);
  const confirmed = Date.parse(swing.confirmedAt);
  if (!Number.isFinite(pivot) || !Number.isFinite(confirmed) || confirmed < pivot) throw new BreakOfStructureDetectionError('INVALID_SWING', 'Confirmed swing timestamps are invalid.');
  if (!Number.isFinite(swing.price) || swing.price <= 0) throw new BreakOfStructureDetectionError('INVALID_SWING', 'Confirmed swing price must be positive and finite.');
}

function normalizeSwings(swings: readonly ConfirmedSwing[]): ConfirmedSwing[] {
  const ids = new Set<string>();
  for (const swing of swings) {
    validateSwing(swing);
    if (ids.has(swing.id)) throw new BreakOfStructureDetectionError('DUPLICATE_SWING_ID', `Duplicate confirmed swing ID: ${swing.id}.`);
    ids.add(swing.id);
  }
  return [...swings].sort((left, right) => Date.parse(left.confirmedAt) - Date.parse(right.confirmedAt) || left.id.localeCompare(right.id));
}

function normalizeSnapshots(snapshots: readonly StructureSnapshot[]): StructureSnapshot[] {
  const ids = new Set<string>();
  const usable: StructureSnapshot[] = [];
  for (const snapshot of snapshots) {
    if (!snapshot.id || ids.has(snapshot.id)) throw new BreakOfStructureDetectionError(ids.has(snapshot.id) ? 'DUPLICATE_SNAPSHOT_ID' : 'INVALID_SNAPSHOT', `Invalid or duplicate structure snapshot ID: ${snapshot.id}.`);
    ids.add(snapshot.id);
    if (snapshot.processedAt === null) continue;
    if (!Number.isFinite(Date.parse(snapshot.processedAt))) throw new BreakOfStructureDetectionError('INVALID_SNAPSHOT', 'Structure snapshot processedAt must be valid.');
    usable.push(snapshot);
  }
  return usable.sort((left, right) => Date.parse(left.processedAt!) - Date.parse(right.processedAt!) || left.id.localeCompare(right.id));
}

function normalizeCandles(candles: readonly NormalizedCandle[], warnings: string[]): NormalizedCandle[] {
  const ordered = [...candles].sort((left, right) => Date.parse(left.openedAt) - Date.parse(right.openedAt));
  const seen = new Set<string>();
  for (const candle of ordered) {
    if (seen.has(candle.openedAt)) throw new BreakOfStructureDetectionError('DUPLICATE_CANDLE', `Duplicate candle openedAt: ${candle.openedAt}.`);
    seen.add(candle.openedAt);
    if ([candle.open, candle.high, candle.low, candle.close].some((price) => !Number.isFinite(price) || price <= 0)) throw new BreakOfStructureDetectionError('INVALID_CANDLES', 'Candle OHLC prices must be positive and finite.');
    if (!Number.isFinite(Date.parse(candle.closedAt)) || Date.parse(candle.closedAt) <= Date.parse(candle.openedAt)) throw new BreakOfStructureDetectionError('INVALID_CANDLES', 'Candle timestamps must form a valid completed interval.');
  }
  const complete = ordered.filter((candle) => {
    if (candle.complete) return true;
    warnings.push(`Ignored incomplete candle at ${candle.openedAt}.`);
    return false;
  });
  const validation = validateCandles(complete);
  if (!validation.valid) throw new BreakOfStructureDetectionError('INVALID_CANDLES', validation.issues.map((issue) => issue.message).join(' '));
  return complete;
}

function classificationsFromSnapshots(snapshots: readonly StructureSnapshot[]): Map<string, ClassifiedSwing> {
  const values = new Map<string, ClassifiedSwing>();
  for (const snapshot of snapshots) {
    for (const classified of [snapshot.previousConfirmedHigh, snapshot.lastConfirmedHigh, snapshot.previousConfirmedLow, snapshot.lastConfirmedLow]) {
      if (classified) values.set(classified.swing.id, classified);
    }
  }
  return values;
}

function latestSnapshotAt(snapshots: readonly StructureSnapshot[], openedAt: string): StructureSnapshot | null {
  const opened = Date.parse(openedAt);
  return snapshots.filter((snapshot) => Date.parse(snapshot.processedAt!) <= opened).at(-1) ?? null;
}

function acceptedAt(snapshots: readonly StructureSnapshot[], openedAt: string): Map<string, ClassifiedSwing> {
  const opened = Date.parse(openedAt);
  return classificationsFromSnapshots(snapshots.filter((snapshot) => Date.parse(snapshot.processedAt!) <= opened));
}

function candidateSources(direction: BreakOfStructureDirection, openedAt: string, swings: readonly ConfirmedSwing[], snapshots: readonly StructureSnapshot[], configuration: BreakOfStructureConfig): { sources: ClassifiedSwing[]; snapshot: StructureSnapshot | null } {
  const snapshot = latestSnapshotAt(snapshots, openedAt);
  if (!snapshot) return { sources: [], snapshot: null };
  const expectedDirection = direction === 'BULLISH' ? 'HIGH' : 'LOW';
  const labels = direction === 'BULLISH' ? configuration.sourceSwingLabels.bullish : configuration.sourceSwingLabels.bearish;
  const confirmedIds = new Set(swings.map((swing) => swing.id));
  const knownBeforeOpen = (classified: ClassifiedSwing): boolean => confirmedIds.has(classified.swing.id) && classified.accepted && classified.swing.direction === expectedDirection && Date.parse(classified.swing.confirmedAt) <= Date.parse(openedAt) && labels.includes(classified.label);
  if (configuration.swingEligibility === 'LATEST_ACCEPTED_STRUCTURE') {
    const latest = direction === 'BULLISH' ? snapshot.lastConfirmedHigh : snapshot.lastConfirmedLow;
    return { sources: latest && knownBeforeOpen(latest) ? [latest] : [], snapshot };
  }
  const accepted = acceptedAt(snapshots, openedAt);
  if (configuration.swingEligibility === 'LATEST_CONFIRMED') {
    const latest = swings.filter((swing) => swing.direction === expectedDirection && Date.parse(swing.confirmedAt) <= Date.parse(openedAt)).at(-1);
    const classified = latest ? accepted.get(latest.id) : undefined;
    return { sources: classified && knownBeforeOpen(classified) ? [classified] : [], snapshot };
  }
  const sources = [...accepted.values()].filter(knownBeforeOpen).sort((left, right) => Date.parse(left.swing.confirmedAt) - Date.parse(right.swing.confirmedAt) || left.swing.id.localeCompare(right.swing.id));
  return { sources, snapshot };
}

export function closeTolerance(sourcePrice: number, configuration: BreakOfStructureConfig): number {
  return Math.max(configuration.closeToleranceAbsolute, Math.abs(sourcePrice) * configuration.closeToleranceRelative);
}

function continuation(direction: BreakOfStructureDirection, bias: StructureSnapshot['bias']): ContinuationContext {
  if (bias === 'UNDEFINED') return 'UNDEFINED';
  if ((direction === 'BULLISH' && bias === 'BULLISH') || (direction === 'BEARISH' && bias === 'BEARISH')) return 'CONTINUATION';
  return 'COUNTER_STRUCTURE';
}

function eventFor(direction: BreakOfStructureDirection, classified: ClassifiedSwing, snapshot: StructureSnapshot, candle: NormalizedCandle, candleIndex: number, configuration: BreakOfStructureConfig): BreakOfStructureEvent {
  const swing = classified.swing;
  const tolerance = closeTolerance(swing.price, configuration);
  const breakDistance = direction === 'BULLISH' ? candle.close - swing.price : swing.price - candle.close;
  const boundary = direction === 'BULLISH' ? swing.price + tolerance : swing.price - tolerance;
  const gapBreak = direction === 'BULLISH' ? candle.open > boundary : candle.open < boundary;
  const context = continuation(direction, snapshot.bias);
  const rejectionReason = configuration.gapBreakPolicy === 'REJECT' && gapBreak
    ? 'GAP_BREAK_REJECTED'
    : configuration.requireDirectionalBias === 'CONTINUATION_ONLY' && context !== 'CONTINUATION'
      ? 'COUNTER_STRUCTURE_OR_UNDEFINED'
      : null;
  const accepted = rejectionReason === null;
  const evidence = [
    `${direction === 'BULLISH' ? 'Bullish' : 'Bearish'} BOS: candle close ${candle.close} ${direction === 'BULLISH' ? 'exceeded' : 'fell below'} confirmed ${classified.label} level ${swing.price} by ${breakDistance}.`,
    `Source swing was confirmed at ${swing.confirmedAt} before breakout candle opened at ${candle.openedAt}.`,
    `Prior structure bias was ${snapshot.bias}.`,
    `Event ${accepted ? 'emitted' : 'rejected'} at breakout candle close ${candle.closedAt}.`,
  ];
  const identity = {
    version: CONFIRMED_STRUCTURE_BOS_VERSION,
    direction,
    sourceSwingId: swing.id,
    breakoutCandle: { index: candleIndex, openedAt: candle.openedAt, closedAt: candle.closedAt, open: candle.open, high: candle.high, low: candle.low, close: candle.close },
    sourcePrice: swing.price,
    sourceSnapshotId: snapshot.id,
    configuration,
    accepted,
    rejectionReason,
  };
  const fingerprint = stableFingerprint(identity);
  return deepFreeze({
    id: `confirmed-structure-bos:${fingerprint}`,
    version: CONFIRMED_STRUCTURE_BOS_VERSION,
    direction,
    sourceSwingId: swing.id,
    sourceSwingDirection: swing.direction,
    sourceSwingLabel: classified.label,
    sourceSwingPrice: swing.price,
    sourcePivotAt: swing.pivotAt,
    sourceConfirmedAt: swing.confirmedAt,
    breakoutCandleIndex: candleIndex,
    breakoutOpenedAt: candle.openedAt,
    detectedAt: candle.closedAt,
    breakoutOpen: candle.open,
    breakoutHigh: candle.high,
    breakoutLow: candle.low,
    breakoutClose: candle.close,
    breakDistance,
    breakDistanceRelative: breakDistance / Math.abs(swing.price),
    priorStructureBias: snapshot.bias,
    continuationContext: context,
    gapBreak,
    accepted,
    rejectionReason,
    sourceSnapshotId: snapshot.id,
    evidence,
    fingerprint,
  });
}

type LevelState = { permanentlyBroken: boolean; awaitingInside: boolean };

export function detectBreaksOfStructure(input: BreakOfStructureDetectionInput): BreakOfStructureDetectionResult {
  const configuration = normalizeConfig(input.config);
  const warnings: string[] = [];
  const candles = normalizeCandles(input.candles, warnings);
  const swings = normalizeSwings(input.confirmedSwings);
  const snapshots = normalizeSnapshots(input.structureSnapshots);
  if (swings.length && !snapshots.length) warnings.push('No usable chronological structure snapshot was available; confirmed swings cannot produce BOS without structure state.');
  const events: BreakOfStructureEvent[] = [];
  const rejectedCandidates: BreakOfStructureEvent[] = [];
  const states = new Map<string, LevelState>();

  candles.forEach((candle, candleIndex) => {
    for (const direction of ['BULLISH', 'BEARISH'] as const) {
      const { sources, snapshot } = candidateSources(direction, candle.openedAt, swings, snapshots, configuration);
      if (!snapshot) continue;
      for (const classified of sources) {
        const state = states.get(classified.swing.id) ?? { permanentlyBroken: false, awaitingInside: false };
        const tolerance = closeTolerance(classified.swing.price, configuration);
        const boundary = direction === 'BULLISH' ? classified.swing.price + tolerance : classified.swing.price - tolerance;
        const inside = direction === 'BULLISH' ? candle.close <= classified.swing.price : candle.close >= classified.swing.price;
        if (configuration.duplicateBreakPolicy === 'ALLOW_REBREAK_AFTER_CLOSE_BACK_INSIDE' && state.awaitingInside && inside) {
          state.awaitingInside = false;
          state.permanentlyBroken = false;
          states.set(classified.swing.id, state);
          continue;
        }
        const breaks = direction === 'BULLISH' ? candle.close > boundary : candle.close < boundary;
        if (!breaks || state.permanentlyBroken || state.awaitingInside) continue;
        const event = eventFor(direction, classified, snapshot, candle, candleIndex, configuration);
        (event.accepted ? events : rejectedCandidates).push(event);
        if (event.accepted) {
          if (configuration.duplicateBreakPolicy === 'EMIT_ONCE_PER_SWING') state.permanentlyBroken = true;
          else state.awaitingInside = true;
          states.set(classified.swing.id, state);
        }
      }
    }
  });
  return deepFreeze({ detectorVersion: CONFIRMED_STRUCTURE_BOS_VERSION, events, rejectedCandidates, warnings, configuration });
}

export function createBreakOfStructureDetector(input: Partial<BreakOfStructureConfig> = {}): IncrementalBreakOfStructureDetector {
  const configuration = normalizeConfig(input);
  const swings: ConfirmedSwing[] = [];
  const snapshots: StructureSnapshot[] = [];
  const candles: NormalizedCandle[] = [];
  const incrementalWarnings: string[] = [];
  let result = detectBreaksOfStructure({ candles, confirmedSwings: swings, structureSnapshots: snapshots, config: configuration });
  let newEvents: BreakOfStructureEvent[] = [];
  const lastCandle = (): NormalizedCandle | undefined => candles.at(-1);
  const api: IncrementalBreakOfStructureDetector = {
    pushConfirmedSwing(swing) {
      validateSwing(swing);
      if (swings.some((existing) => existing.id === swing.id)) throw new BreakOfStructureDetectionError('DUPLICATE_SWING_ID', `Duplicate confirmed swing ID: ${swing.id}.`);
      if (swings.at(-1) && Date.parse(swing.confirmedAt) < Date.parse(swings.at(-1)!.confirmedAt)) throw new BreakOfStructureDetectionError('OUT_OF_ORDER_INCREMENTAL_INPUT', 'Incremental confirmed swings must not move backward in confirmedAt.');
      if (lastCandle() && Date.parse(swing.confirmedAt) <= Date.parse(lastCandle()!.openedAt)) throw new BreakOfStructureDetectionError('LATE_INCREMENTAL_INFORMATION', 'A swing known before an already processed candle cannot be added retroactively.');
      swings.push(deepFreeze(structuredClone(swing)));
    },
    pushStructureSnapshot(snapshot) {
      if (!snapshot.id || snapshot.processedAt === null || !Number.isFinite(Date.parse(snapshot.processedAt))) throw new BreakOfStructureDetectionError('INVALID_SNAPSHOT', 'Incremental snapshots require a valid ID and processedAt.');
      if (snapshots.some((existing) => existing.id === snapshot.id)) throw new BreakOfStructureDetectionError('DUPLICATE_SNAPSHOT_ID', `Duplicate structure snapshot ID: ${snapshot.id}.`);
      if (snapshots.at(-1) && Date.parse(snapshot.processedAt) < Date.parse(snapshots.at(-1)!.processedAt!)) throw new BreakOfStructureDetectionError('OUT_OF_ORDER_INCREMENTAL_INPUT', 'Incremental snapshots must not move backward in processedAt.');
      if (lastCandle() && Date.parse(snapshot.processedAt) <= Date.parse(lastCandle()!.openedAt)) throw new BreakOfStructureDetectionError('LATE_INCREMENTAL_INFORMATION', 'A snapshot available before an already processed candle cannot be added retroactively.');
      snapshots.push(deepFreeze(structuredClone(snapshot)));
    },
    pushCandle(candle) {
      const validationWarnings: string[] = [];
      const validated = normalizeCandles([candle], validationWarnings);
      if (!candle.complete) {
        incrementalWarnings.push(...validationWarnings);
        newEvents = [];
        return Object.freeze([]);
      }
      const previous = lastCandle();
      if (previous && Date.parse(candle.openedAt) <= Date.parse(previous.openedAt)) throw new BreakOfStructureDetectionError('OUT_OF_ORDER_INCREMENTAL_INPUT', 'Incremental candles must have unique, ascending openedAt timestamps.');
      const previousFingerprints = new Set(result.events.map((event) => event.fingerprint));
      candles.push(deepFreeze(structuredClone(validated[0]!)));
      result = detectBreaksOfStructure({ candles, confirmedSwings: swings, structureSnapshots: snapshots, config: configuration });
      newEvents = result.events.filter((event) => !previousFingerprints.has(event.fingerprint));
      return deepFreeze([...newEvents]);
    },
    getNewEvents() {
      const values = deepFreeze([...newEvents]);
      newEvents = [];
      return values;
    },
    getAllEvents() { return deepFreeze([...result.events]); },
    getRejectedCandidates() { return deepFreeze([...result.rejectedCandidates]); },
    getWarnings() { return deepFreeze([...incrementalWarnings, ...result.warnings]); },
    getResult() { return deepFreeze({ ...result, warnings: [...incrementalWarnings, ...result.warnings] }); },
    reset() {
      swings.length = 0;
      snapshots.length = 0;
      candles.length = 0;
      incrementalWarnings.length = 0;
      newEvents = [];
      result = detectBreaksOfStructure({ candles, confirmedSwings: swings, structureSnapshots: snapshots, config: configuration });
    },
  };
  return Object.freeze(api);
}

export function serializeBreakOfStructureResult(result: BreakOfStructureDetectionResult): string {
  return canonicalStringify(result);
}
