import { simpleAtr, validateCandles } from '../../analysis-utils/index.ts';
import type { NormalizedCandle } from '../../contracts.ts';
import type { ConfirmedSwing } from '../../detectors/confirmed-swing/confirmed-swing-types.ts';
import { canonicalStringify, stableFingerprint } from '../../serialization/stable-fingerprint.ts';
import type { BreakOfStructureEvent } from '../../structure/break-of-structure/break-of-structure-types.ts';
import type { ClassifiedSwing, StructureSnapshot, SwingStructureLabel } from '../../structure/structure-types.ts';
import type { IncrementalStructuralLiquiditySweepDetector, LiquiditySourceType, LiquiditySweepDirection, StructuralLiquiditySweepConfig, StructuralLiquiditySweepEvent, StructuralLiquiditySweepInput, StructuralLiquiditySweepResult } from './structural-liquidity-sweep-types.ts';

export const STRUCTURAL_LIQUIDITY_SWEEP_VERSION = '1.0.0';
const HIGH_LABELS: SwingStructureLabel[] = ['INITIAL_HIGH', 'HH', 'LH', 'EH'];
const LOW_LABELS: SwingStructureLabel[] = ['INITIAL_LOW', 'HL', 'LL', 'EL'];

export const DEFAULT_STRUCTURAL_LIQUIDITY_SWEEP_CONFIG: StructuralLiquiditySweepConfig = Object.freeze({
  sourceEligibility: 'LATEST_ACCEPTED_STRUCTURE',
  allowedSourceLabels: Object.freeze({ buySide: Object.freeze([...HIGH_LABELS]), sellSide: Object.freeze([...LOW_LABELS]) }),
  excursionToleranceAbsolute: 0,
  excursionToleranceRelative: 0,
  reclaimToleranceAbsolute: 0,
  reclaimToleranceRelative: 0,
  minimumExcursionAbsolute: 0,
  minimumExcursionRelative: 0,
  minimumExcursionAtrMultiple: 0,
  atrPeriod: 14,
  closePolicy: 'CLOSE_AT_OR_INSIDE',
  bosConflictPolicy: 'BOS_WINS',
  consumptionPolicy: 'CONSUME_ONCE',
  repeatResetPolicy: 'AFTER_NEW_STRUCTURAL_LEVEL',
  gapPolicy: 'ALLOW',
  sameCandleDualSweepPolicy: 'REJECT_AMBIGUOUS',
}) as StructuralLiquiditySweepConfig;

export class StructuralLiquiditySweepError extends Error {
  readonly code: 'INVALID_CONFIGURATION' | 'INVALID_CANDLES' | 'INVALID_SWING' | 'INVALID_SNAPSHOT' | 'INVALID_BOS_EVENT' | 'DUPLICATE_SWING_ID' | 'DUPLICATE_SNAPSHOT_ID' | 'DUPLICATE_BOS_ID' | 'DUPLICATE_CANDLE' | 'OUT_OF_ORDER_INCREMENTAL_INPUT' | 'LATE_INCREMENTAL_INFORMATION';
  constructor(code: StructuralLiquiditySweepError['code'], message: string) {
    super(message); this.name = 'StructuralLiquiditySweepError'; this.code = code;
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function normalizeConfig(input: Partial<StructuralLiquiditySweepConfig> = {}): StructuralLiquiditySweepConfig {
  const labels = {
    buySide: [...(input.allowedSourceLabels?.buySide ?? HIGH_LABELS)],
    sellSide: [...(input.allowedSourceLabels?.sellSide ?? LOW_LABELS)],
  };
  const config: StructuralLiquiditySweepConfig = {
    sourceEligibility: input.sourceEligibility ?? 'LATEST_ACCEPTED_STRUCTURE',
    allowedSourceLabels: labels,
    excursionToleranceAbsolute: input.excursionToleranceAbsolute ?? 0,
    excursionToleranceRelative: input.excursionToleranceRelative ?? 0,
    reclaimToleranceAbsolute: input.reclaimToleranceAbsolute ?? 0,
    reclaimToleranceRelative: input.reclaimToleranceRelative ?? 0,
    minimumExcursionAbsolute: input.minimumExcursionAbsolute ?? 0,
    minimumExcursionRelative: input.minimumExcursionRelative ?? 0,
    minimumExcursionAtrMultiple: input.minimumExcursionAtrMultiple ?? 0,
    atrPeriod: input.atrPeriod ?? 14,
    closePolicy: input.closePolicy ?? 'CLOSE_AT_OR_INSIDE',
    bosConflictPolicy: input.bosConflictPolicy ?? 'BOS_WINS',
    consumptionPolicy: input.consumptionPolicy ?? 'CONSUME_ONCE',
    repeatResetPolicy: input.repeatResetPolicy ?? 'AFTER_NEW_STRUCTURAL_LEVEL',
    gapPolicy: input.gapPolicy ?? 'ALLOW',
    sameCandleDualSweepPolicy: input.sameCandleDualSweepPolicy ?? 'REJECT_AMBIGUOUS',
  };
  if (!['LATEST_CONFIRMED', 'LATEST_ACCEPTED_STRUCTURE', 'ALL_UNCONSUMED_ACCEPTED'].includes(config.sourceEligibility)) throw new StructuralLiquiditySweepError('INVALID_CONFIGURATION', 'Unknown sourceEligibility.');
  if (labels.buySide.some((label) => !HIGH_LABELS.includes(label)) || labels.sellSide.some((label) => !LOW_LABELS.includes(label))) throw new StructuralLiquiditySweepError('INVALID_CONFIGURATION', 'Allowed labels must match source direction.');
  for (const [key, value] of Object.entries({
    excursionToleranceAbsolute: config.excursionToleranceAbsolute,
    excursionToleranceRelative: config.excursionToleranceRelative,
    reclaimToleranceAbsolute: config.reclaimToleranceAbsolute,
    reclaimToleranceRelative: config.reclaimToleranceRelative,
    minimumExcursionAbsolute: config.minimumExcursionAbsolute,
    minimumExcursionRelative: config.minimumExcursionRelative,
    minimumExcursionAtrMultiple: config.minimumExcursionAtrMultiple,
  })) {
    if (!Number.isFinite(value) || value < 0) throw new StructuralLiquiditySweepError('INVALID_CONFIGURATION', `${key} must be non-negative and finite.`);
  }
  if (!Number.isInteger(config.atrPeriod) || config.atrPeriod < 1) throw new StructuralLiquiditySweepError('INVALID_CONFIGURATION', 'atrPeriod must be a positive integer.');
  if (!['CLOSE_BACK_INSIDE', 'CLOSE_AT_OR_INSIDE', 'CLOSE_BEYOND_ALLOWED_IF_NO_BOS'].includes(config.closePolicy)
    || !['BOS_WINS', 'SWEEP_WINS', 'REJECT_AMBIGUOUS'].includes(config.bosConflictPolicy)
    || !['CONSUME_ONCE', 'ALLOW_REPEAT_AFTER_RESET'].includes(config.consumptionPolicy)
    || !['AFTER_NEW_STRUCTURAL_LEVEL', 'AFTER_CLOSE_BACK_BEYOND_LEVEL', 'MANUAL_ONLY'].includes(config.repeatResetPolicy)
    || !['ALLOW', 'REJECT'].includes(config.gapPolicy)
    || !['ALLOW_BOTH', 'PROCESS_BUY_SIDE_THEN_SELL_SIDE', 'PROCESS_SELL_SIDE_THEN_BUY_SIDE', 'REJECT_AMBIGUOUS'].includes(config.sameCandleDualSweepPolicy)) throw new StructuralLiquiditySweepError('INVALID_CONFIGURATION', 'Unknown structural sweep policy.');
  return deepFreeze(config);
}

function time(value: string, code: StructuralLiquiditySweepError['code'], subject: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new StructuralLiquiditySweepError(code, `${subject} timestamp is invalid.`);
  return parsed;
}

function normalizeCandles(values: readonly NormalizedCandle[], warnings: string[]): NormalizedCandle[] {
  const ordered = [...values].sort((a, b) => time(a.openedAt, 'INVALID_CANDLES', 'Candle') - time(b.openedAt, 'INVALID_CANDLES', 'Candle'));
  const seen = new Set<string>();
  for (const candle of ordered) {
    if (seen.has(candle.openedAt)) throw new StructuralLiquiditySweepError('DUPLICATE_CANDLE', `Duplicate candle openedAt: ${candle.openedAt}.`);
    seen.add(candle.openedAt);
    if ([candle.open, candle.high, candle.low, candle.close].some((value) => !Number.isFinite(value) || value <= 0)) throw new StructuralLiquiditySweepError('INVALID_CANDLES', 'OHLC prices must be positive and finite.');
    if (time(candle.closedAt, 'INVALID_CANDLES', 'Candle') <= time(candle.openedAt, 'INVALID_CANDLES', 'Candle')) throw new StructuralLiquiditySweepError('INVALID_CANDLES', 'Candle close must follow open.');
  }
  const completed = ordered.filter((candle) => {
    if (candle.complete) return true;
    warnings.push(`Ignored incomplete candle at ${candle.openedAt}.`);
    return false;
  });
  const validation = validateCandles(completed);
  if (!validation.valid) throw new StructuralLiquiditySweepError('INVALID_CANDLES', validation.issues.map((issue) => issue.message).join(' '));
  return completed;
}

function normalizeSwings(values: readonly ConfirmedSwing[]): ConfirmedSwing[] {
  const seen = new Set<string>();
  for (const swing of values) {
    if (!swing.id || seen.has(swing.id)) throw new StructuralLiquiditySweepError(seen.has(swing.id) ? 'DUPLICATE_SWING_ID' : 'INVALID_SWING', `Invalid or duplicate swing ID: ${swing.id}.`);
    seen.add(swing.id);
    if (!Number.isFinite(swing.price) || swing.price <= 0 || time(swing.confirmedAt, 'INVALID_SWING', 'Swing') < time(swing.pivotAt, 'INVALID_SWING', 'Swing')) throw new StructuralLiquiditySweepError('INVALID_SWING', 'Swing price or timestamps are invalid.');
  }
  return [...values].sort((a, b) => time(a.confirmedAt, 'INVALID_SWING', 'Swing') - time(b.confirmedAt, 'INVALID_SWING', 'Swing') || a.id.localeCompare(b.id));
}

function normalizeSnapshots(values: readonly StructureSnapshot[]): StructureSnapshot[] {
  const seen = new Set<string>();
  for (const snapshot of values) {
    if (!snapshot.id || seen.has(snapshot.id) || snapshot.processedAt === null) throw new StructuralLiquiditySweepError(seen.has(snapshot.id) ? 'DUPLICATE_SNAPSHOT_ID' : 'INVALID_SNAPSHOT', `Invalid or duplicate snapshot ID: ${snapshot.id}.`);
    seen.add(snapshot.id); time(snapshot.processedAt, 'INVALID_SNAPSHOT', 'Snapshot');
  }
  return [...values].sort((a, b) => time(a.processedAt!, 'INVALID_SNAPSHOT', 'Snapshot') - time(b.processedAt!, 'INVALID_SNAPSHOT', 'Snapshot') || a.id.localeCompare(b.id));
}

function normalizeBos(values: readonly BreakOfStructureEvent[]): BreakOfStructureEvent[] {
  const seen = new Set<string>();
  for (const event of values) {
    if (!event.id || seen.has(event.id)) throw new StructuralLiquiditySweepError(seen.has(event.id) ? 'DUPLICATE_BOS_ID' : 'INVALID_BOS_EVENT', `Invalid or duplicate BOS ID: ${event.id}.`);
    seen.add(event.id); time(event.detectedAt, 'INVALID_BOS_EVENT', 'BOS');
  }
  return [...values].sort((a, b) => time(a.detectedAt, 'INVALID_BOS_EVENT', 'BOS') - time(b.detectedAt, 'INVALID_BOS_EVENT', 'BOS') || a.id.localeCompare(b.id));
}

type Source = { swing: ConfirmedSwing; classified: ClassifiedSwing | null; snapshot: StructureSnapshot | null; type: LiquiditySourceType };

function classificationsBefore(snapshots: readonly StructureSnapshot[], openedAt: string): Map<string, { classified: ClassifiedSwing; snapshot: StructureSnapshot }> {
  const map = new Map<string, { classified: ClassifiedSwing; snapshot: StructureSnapshot }>();
  for (const snapshot of snapshots) {
    if (time(snapshot.processedAt!, 'INVALID_SNAPSHOT', 'Snapshot') >= time(openedAt, 'INVALID_CANDLES', 'Candle')) break;
    for (const classified of [snapshot.previousConfirmedHigh, snapshot.lastConfirmedHigh, snapshot.previousConfirmedLow, snapshot.lastConfirmedLow]) if (classified?.accepted) map.set(classified.swing.id, { classified, snapshot });
  }
  return map;
}

function sourcesFor(direction: LiquiditySweepDirection, candle: NormalizedCandle, swings: readonly ConfirmedSwing[], snapshots: readonly StructureSnapshot[], config: StructuralLiquiditySweepConfig): Source[] {
  const swingDirection = direction === 'BUY_SIDE' ? 'HIGH' : 'LOW';
  const allowedLabels = direction === 'BUY_SIDE' ? config.allowedSourceLabels.buySide : config.allowedSourceLabels.sellSide;
  const knownSwings = swings.filter((swing) => swing.direction === swingDirection && time(swing.confirmedAt, 'INVALID_SWING', 'Swing') < time(candle.openedAt, 'INVALID_CANDLES', 'Candle'));
  const classified = classificationsBefore(snapshots, candle.openedAt);
  if (config.sourceEligibility === 'LATEST_CONFIRMED') {
    const latest = knownSwings.at(-1);
    if (!latest) return [];
    const context = classified.get(latest.id);
    return [{ swing: latest, classified: context?.classified ?? null, snapshot: context?.snapshot ?? null, type: 'CONFIRMED_SWING' }];
  }
  const accepted = [...classified.values()]
    .filter((value) => value.classified.swing.direction === swingDirection && allowedLabels.includes(value.classified.label) && knownSwings.some((swing) => swing.id === value.classified.swing.id))
    .sort((a, b) => time(a.classified.swing.confirmedAt, 'INVALID_SWING', 'Swing') - time(b.classified.swing.confirmedAt, 'INVALID_SWING', 'Swing') || a.classified.swing.id.localeCompare(b.classified.swing.id));
  const selected = config.sourceEligibility === 'LATEST_ACCEPTED_STRUCTURE' ? accepted.slice(-1) : accepted;
  return selected.map((value) => ({ swing: value.classified.swing, classified: value.classified, snapshot: value.snapshot, type: 'ACCEPTED_STRUCTURE_SWING' }));
}

const tolerance = (price: number, absolute: number, relative: number): number => Math.max(absolute, Math.abs(price) * relative);
function reclaimPass(direction: LiquiditySweepDirection, close: number, price: number, reclaim: number, policy: StructuralLiquiditySweepConfig['closePolicy']): boolean {
  if (policy === 'CLOSE_BACK_INSIDE') return direction === 'BUY_SIDE' ? close < price : close > price;
  return direction === 'BUY_SIDE' ? close <= price + reclaim : close >= price - reclaim;
}

type LevelState = { consumed: boolean; awaitingReset: boolean };

function eventFor(args: {
  direction: LiquiditySweepDirection; source: Source; candle: NormalizedCandle; index: number; config: StructuralLiquiditySweepConfig;
  bos: BreakOfStructureEvent | null; atrMultiple: number | null; accepted: boolean; reason: string | null; consumedSource: boolean; evidence: string[];
}): StructuralLiquiditySweepEvent {
  const { direction, source, candle, index, config } = args;
  const excursion = direction === 'BUY_SIDE' ? candle.high - source.swing.price : source.swing.price - candle.low;
  const reclaimDistance = direction === 'BUY_SIDE' ? source.swing.price - candle.close : candle.close - source.swing.price;
  const gapBoundary = tolerance(source.swing.price, config.excursionToleranceAbsolute, config.excursionToleranceRelative);
  const gapSweep = direction === 'BUY_SIDE' ? candle.open > source.swing.price + gapBoundary : candle.open < source.swing.price - gapBoundary;
  const evidence = [...args.evidence];
  const identity = { version: STRUCTURAL_LIQUIDITY_SWEEP_VERSION, direction, sourceSwingId: source.swing.id, sourceSnapshotId: source.snapshot?.id ?? null, candle: { index, ...candle }, excursion, reclaimDistance, conflictingBosEventId: args.bos?.id ?? null, configuration: config, accepted: args.accepted, rejectionReason: args.reason };
  const fingerprint = stableFingerprint(identity);
  return deepFreeze({
    id: `structural-liquidity-sweep:${fingerprint}`, version: STRUCTURAL_LIQUIDITY_SWEEP_VERSION, direction, sourceType: source.type,
    sourceSwingId: source.swing.id, sourceSwingDirection: source.swing.direction, sourceSwingLabel: source.classified?.label ?? null,
    sourcePrice: source.swing.price, sourcePivotAt: source.swing.pivotAt, sourceConfirmedAt: source.swing.confirmedAt,
    sourceSnapshotId: source.snapshot?.id ?? null, priorStructureBias: source.snapshot?.bias ?? 'UNDEFINED',
    sweepCandleIndex: index, sweepOpenedAt: candle.openedAt, detectedAt: candle.closedAt,
    open: candle.open, high: candle.high, low: candle.low, close: candle.close,
    excursionDistance: excursion, excursionDistanceRelative: excursion / Math.abs(source.swing.price), excursionAtrMultiple: args.atrMultiple,
    reclaimDistance, wickLengthBeyondLevel: excursion, closePositionRelativeToSource: candle.close - source.swing.price,
    gapSweep, conflictingBosEventId: args.bos?.id ?? null, consumedSource: args.consumedSource,
    accepted: args.accepted, rejectionReason: args.reason, evidence, fingerprint,
  });
}

export function detectStructuralLiquiditySweeps(input: StructuralLiquiditySweepInput): StructuralLiquiditySweepResult {
  const configuration = normalizeConfig(input.config);
  const warnings: string[] = [];
  const candles = normalizeCandles(input.candles, warnings), swings = normalizeSwings(input.confirmedSwings);
  const snapshots = normalizeSnapshots(input.structureSnapshots), bosEvents = normalizeBos(input.bosEvents ?? []);
  const events: StructuralLiquiditySweepEvent[] = [], rejectedCandidates: StructuralLiquiditySweepEvent[] = [];
  const states = new Map<string, LevelState>();

  candles.forEach((candle, candleIndex) => {
    const raw: Array<{ direction: LiquiditySweepDirection; source: Source; bos: BreakOfStructureEvent | null; atrMultiple: number | null; reason: string | null }> = [];
    for (const direction of ['BUY_SIDE', 'SELL_SIDE'] as const) {
      for (const source of sourcesFor(direction, candle, swings, snapshots, configuration)) {
        const excursionTolerance = tolerance(source.swing.price, configuration.excursionToleranceAbsolute, configuration.excursionToleranceRelative);
        const reclaimTolerance = tolerance(source.swing.price, configuration.reclaimToleranceAbsolute, configuration.reclaimToleranceRelative);
        const excursion = direction === 'BUY_SIDE' ? candle.high - source.swing.price : source.swing.price - candle.low;
        const excursionRelative = excursion / Math.abs(source.swing.price);
        const state = states.get(source.swing.id) ?? { consumed: false, awaitingReset: false };
        if (configuration.consumptionPolicy === 'ALLOW_REPEAT_AFTER_RESET' && configuration.repeatResetPolicy === 'AFTER_CLOSE_BACK_BEYOND_LEVEL' && state.awaitingReset) {
          const reset = direction === 'BUY_SIDE' ? candle.close > source.swing.price : candle.close < source.swing.price;
          if (reset) { state.consumed = false; state.awaitingReset = false; states.set(source.swing.id, state); }
          continue;
        }
        const exceeded = direction === 'BUY_SIDE' ? candle.high > source.swing.price + excursionTolerance : candle.low < source.swing.price - excursionTolerance;
        if (!exceeded || !reclaimPass(direction, candle.close, source.swing.price, reclaimTolerance, configuration.closePolicy)) continue;
        const bosDirection = direction === 'BUY_SIDE' ? 'BULLISH' : 'BEARISH';
        const suppliedBos = bosEvents.find((event) => event.accepted && event.direction === bosDirection && event.sourceSwingId === source.swing.id && event.breakoutOpenedAt === candle.openedAt) ?? null;
        const screenedConflict = suppliedBos === null && (direction === 'BUY_SIDE' ? candle.close > source.swing.price : candle.close < source.swing.price);
        const conflict = suppliedBos !== null || screenedConflict;
        let reason: string | null = null;
        if (state.consumed) reason = 'SOURCE_ALREADY_CONSUMED';
        const gap = direction === 'BUY_SIDE' ? candle.open > source.swing.price + excursionTolerance : candle.open < source.swing.price - excursionTolerance;
        if (!reason && gap && configuration.gapPolicy === 'REJECT') reason = 'GAP_SWEEP_REJECTED';
        if (!reason && conflict && configuration.bosConflictPolicy === 'BOS_WINS') reason = 'CONFLICTING_ACCEPTED_BOS';
        if (!reason && conflict && configuration.bosConflictPolicy === 'REJECT_AMBIGUOUS') reason = 'AMBIGUOUS_BOS_SWEEP_CONFLICT';
        let atrMultiple: number | null = null;
        const requiresAtr = configuration.minimumExcursionAtrMultiple > 0;
        if (!reason && requiresAtr) {
          const atr = simpleAtr(candles.filter((value) => time(value.closedAt, 'INVALID_CANDLES', 'Candle') <= time(candle.closedAt, 'INVALID_CANDLES', 'Candle')), configuration.atrPeriod);
          if (!atr.sufficientData || atr.value === null) reason = 'INSUFFICIENT_ATR_HISTORY';
          else { atrMultiple = excursion / atr.value; if (atrMultiple < configuration.minimumExcursionAtrMultiple) reason = 'ATR_EXCURSION_BELOW_MINIMUM'; }
        }
        if (!reason && excursion < configuration.minimumExcursionAbsolute) reason = 'ABSOLUTE_EXCURSION_BELOW_MINIMUM';
        if (!reason && excursionRelative < configuration.minimumExcursionRelative) reason = 'RELATIVE_EXCURSION_BELOW_MINIMUM';
        raw.push({ direction, source, bos: suppliedBos, atrMultiple, reason });
      }
    }

    const hasBuy = raw.some((candidate) => candidate.direction === 'BUY_SIDE' && candidate.reason === null);
    const hasSell = raw.some((candidate) => candidate.direction === 'SELL_SIDE' && candidate.reason === null);
    if (hasBuy && hasSell && configuration.sameCandleDualSweepPolicy === 'REJECT_AMBIGUOUS') {
      for (const candidate of raw) if (candidate.reason === null) candidate.reason = 'AMBIGUOUS_DUAL_SWEEP';
    }
    const sideOrder = configuration.sameCandleDualSweepPolicy === 'PROCESS_SELL_SIDE_THEN_BUY_SIDE' ? ['SELL_SIDE', 'BUY_SIDE'] : ['BUY_SIDE', 'SELL_SIDE'];
    raw.sort((a, b) => sideOrder.indexOf(a.direction) - sideOrder.indexOf(b.direction) || a.source.swing.id.localeCompare(b.source.swing.id));
    for (const candidate of raw) {
      const accepted = candidate.reason === null;
      const side = candidate.direction === 'BUY_SIDE' ? 'Buy-side' : 'Sell-side';
      const extreme = candidate.direction === 'BUY_SIDE' ? candle.high : candle.low;
      const evidence = [
        `${side} liquidity sweep: ${candidate.direction === 'BUY_SIDE' ? 'high' : 'low'} ${extreme} exceeded confirmed structural ${candidate.direction === 'BUY_SIDE' ? 'high' : 'low'} ${candidate.source.swing.price}.`,
        `The candle closed at ${candle.close}, ${reclaimPass(candidate.direction, candle.close, candidate.source.swing.price, tolerance(candidate.source.swing.price, configuration.reclaimToleranceAbsolute, configuration.reclaimToleranceRelative), configuration.closePolicy) ? 'reclaiming' : 'not reclaiming'} the structural level.`,
        `Source swing was confirmed at ${candidate.source.swing.confirmedAt} before the sweep candle opened at ${candle.openedAt}.`,
        candidate.bos ? `Accepted conflicting BOS was ${candidate.bos.id}.` : 'No supplied accepted BOS existed for the same source level and candle.',
        accepted ? 'Sweep indicates liquidity removal; it does not confirm reversal.' : `Candidate was rejected: ${candidate.reason}.`,
      ];
      const state = states.get(candidate.source.swing.id) ?? { consumed: false, awaitingReset: false };
      const event = eventFor({ ...candidate, candle, index: candleIndex, config: configuration, accepted, consumedSource: accepted, evidence });
      (accepted ? events : rejectedCandidates).push(event);
      if (accepted) {
        state.consumed = true;
        state.awaitingReset = configuration.consumptionPolicy === 'ALLOW_REPEAT_AFTER_RESET';
        states.set(candidate.source.swing.id, state);
      }
    }
  });
  return deepFreeze({ detectorVersion: STRUCTURAL_LIQUIDITY_SWEEP_VERSION, events, rejectedCandidates, warnings, configuration });
}

export function createStructuralLiquiditySweepDetector(input: Partial<StructuralLiquiditySweepConfig> = {}): IncrementalStructuralLiquiditySweepDetector {
  const configuration = normalizeConfig(input);
  const candles: NormalizedCandle[] = [], swings: ConfirmedSwing[] = [], snapshots: StructureSnapshot[] = [], bosEvents: BreakOfStructureEvent[] = [];
  let result = detectStructuralLiquiditySweeps({ candles, confirmedSwings: swings, structureSnapshots: snapshots, bosEvents, config: configuration });
  let newEvents: StructuralLiquiditySweepEvent[] = [];
  const lastOpen = () => candles.at(-1)?.openedAt;
  const api: IncrementalStructuralLiquiditySweepDetector = {
    pushConfirmedSwing(swing) {
      if (swings.some((value) => value.id === swing.id)) throw new StructuralLiquiditySweepError('DUPLICATE_SWING_ID', `Duplicate swing ID: ${swing.id}.`);
      if (swings.at(-1) && time(swing.confirmedAt, 'INVALID_SWING', 'Swing') < time(swings.at(-1)!.confirmedAt, 'INVALID_SWING', 'Swing')) throw new StructuralLiquiditySweepError('OUT_OF_ORDER_INCREMENTAL_INPUT', 'Confirmed swings must not move backward.');
      if (lastOpen() && time(swing.confirmedAt, 'INVALID_SWING', 'Swing') <= time(lastOpen()!, 'INVALID_CANDLES', 'Candle')) throw new StructuralLiquiditySweepError('LATE_INCREMENTAL_INFORMATION', 'Swing cannot be inserted into processed history.');
      swings.push(deepFreeze(structuredClone(swing)));
    },
    pushStructureSnapshot(snapshot) {
      if (snapshots.some((value) => value.id === snapshot.id)) throw new StructuralLiquiditySweepError('DUPLICATE_SNAPSHOT_ID', `Duplicate snapshot ID: ${snapshot.id}.`);
      if (snapshot.processedAt === null) throw new StructuralLiquiditySweepError('INVALID_SNAPSHOT', 'Snapshot requires processedAt.');
      if (snapshots.at(-1) && time(snapshot.processedAt, 'INVALID_SNAPSHOT', 'Snapshot') < time(snapshots.at(-1)!.processedAt!, 'INVALID_SNAPSHOT', 'Snapshot')) throw new StructuralLiquiditySweepError('OUT_OF_ORDER_INCREMENTAL_INPUT', 'Snapshots must not move backward.');
      if (lastOpen() && time(snapshot.processedAt, 'INVALID_SNAPSHOT', 'Snapshot') <= time(lastOpen()!, 'INVALID_CANDLES', 'Candle')) throw new StructuralLiquiditySweepError('LATE_INCREMENTAL_INFORMATION', 'Snapshot cannot be inserted into processed history.');
      snapshots.push(deepFreeze(structuredClone(snapshot)));
    },
    pushBosEvent(event) {
      if (bosEvents.some((value) => value.id === event.id)) throw new StructuralLiquiditySweepError('DUPLICATE_BOS_ID', `Duplicate BOS ID: ${event.id}.`);
      if (bosEvents.at(-1) && time(event.detectedAt, 'INVALID_BOS_EVENT', 'BOS') < time(bosEvents.at(-1)!.detectedAt, 'INVALID_BOS_EVENT', 'BOS')) throw new StructuralLiquiditySweepError('OUT_OF_ORDER_INCREMENTAL_INPUT', 'BOS events must not move backward.');
      if (lastOpen() && time(event.breakoutOpenedAt, 'INVALID_BOS_EVENT', 'BOS') <= time(lastOpen()!, 'INVALID_CANDLES', 'Candle')) throw new StructuralLiquiditySweepError('LATE_INCREMENTAL_INFORMATION', 'BOS cannot mutate processed sweep history.');
      bosEvents.push(deepFreeze(structuredClone(event)));
    },
    pushCandle(candle) {
      if (lastOpen() && time(candle.openedAt, 'INVALID_CANDLES', 'Candle') <= time(lastOpen()!, 'INVALID_CANDLES', 'Candle')) throw new StructuralLiquiditySweepError('OUT_OF_ORDER_INCREMENTAL_INPUT', 'Candles must have unique ascending openedAt.');
      const previous = new Set(result.events.map((event) => event.fingerprint));
      candles.push(deepFreeze(structuredClone(candle)));
      result = detectStructuralLiquiditySweeps({ candles, confirmedSwings: swings, structureSnapshots: snapshots, bosEvents, config: configuration });
      newEvents = result.events.filter((event) => !previous.has(event.fingerprint));
      return deepFreeze([...newEvents]);
    },
    getNewEvents() { const value = deepFreeze([...newEvents]); newEvents = []; return value; },
    getAllEvents() { return deepFreeze([...result.events]); },
    getRejectedCandidates() { return deepFreeze([...result.rejectedCandidates]); },
    getWarnings() { return deepFreeze([...result.warnings]); },
    getResult() { return result; },
    reset() { candles.length = swings.length = snapshots.length = bosEvents.length = 0; newEvents = []; result = detectStructuralLiquiditySweeps({ candles, confirmedSwings: swings, structureSnapshots: snapshots, bosEvents, config: configuration }); },
  };
  return Object.freeze(api);
}

export function serializeStructuralLiquiditySweepResult(result: StructuralLiquiditySweepResult): string {
  return canonicalStringify(result);
}
