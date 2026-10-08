import { simpleAtr, validateCandles } from '../../analysis-utils/index.ts';
import type { NormalizedCandle } from '../../contracts.ts';
import type { ConfirmedSwing } from '../../detectors/confirmed-swing/confirmed-swing-types.ts';
import { canonicalStringify, stableFingerprint } from '../../serialization/stable-fingerprint.ts';
import type { BreakOfStructureEvent } from '../break-of-structure/break-of-structure-types.ts';
import type { ClassifiedSwing, StructureBias, StructureSnapshot } from '../structure-types.ts';
import type { IncrementalMarketStructureShiftClassifier, MarketStructureShiftConfig, MarketStructureShiftEvent, MarketStructureShiftInput, MarketStructureShiftResult, StructureTransitionClassification } from './market-structure-shift-types.ts';

export const MARKET_STRUCTURE_SHIFT_VERSION = '1.0.0';

export const DEFAULT_MARKET_STRUCTURE_SHIFT_CONFIG: MarketStructureShiftConfig = Object.freeze({
  terminologyMode: 'CHOCH_FIRST_THEN_MSS',
  requireEstablishedBias: true,
  minimumPriorDirectionalSnapshots: 1,
  requireBreakOfProtectedSwing: true,
  protectedSwingPolicy: 'LAST_HL_FOR_BULLISH_LAST_LH_FOR_BEARISH',
  requireDisplacement: false,
  minimumBreakDistanceAbsolute: 0,
  minimumBreakDistanceRelative: 0,
  minimumBreakDistanceAtrMultiple: 0,
  atrPeriod: 14,
  duplicatePolicy: 'ONE_SHIFT_PER_PRIOR_BIAS_REGIME',
  transitionResetPolicy: 'AFTER_NEW_DIRECTIONAL_STRUCTURE',
}) as MarketStructureShiftConfig;

export class MarketStructureShiftError extends Error {
  readonly code: 'INVALID_CONFIGURATION' | 'INVALID_BOS_EVENT' | 'INVALID_SNAPSHOT' | 'INVALID_SWING' | 'INVALID_CANDLES' | 'DUPLICATE_BOS_ID' | 'DUPLICATE_SNAPSHOT_ID' | 'DUPLICATE_SWING_ID' | 'DUPLICATE_CANDLE' | 'OUT_OF_ORDER_INCREMENTAL_INPUT' | 'LATE_INCREMENTAL_INFORMATION';
  constructor(code: MarketStructureShiftError['code'], message: string) {
    super(message);
    this.name = 'MarketStructureShiftError';
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

function normalizeConfig(input: Partial<MarketStructureShiftConfig> = {}): MarketStructureShiftConfig {
  const config: MarketStructureShiftConfig = {
    terminologyMode: input.terminologyMode ?? DEFAULT_MARKET_STRUCTURE_SHIFT_CONFIG.terminologyMode,
    requireEstablishedBias: input.requireEstablishedBias ?? DEFAULT_MARKET_STRUCTURE_SHIFT_CONFIG.requireEstablishedBias,
    minimumPriorDirectionalSnapshots: input.minimumPriorDirectionalSnapshots ?? DEFAULT_MARKET_STRUCTURE_SHIFT_CONFIG.minimumPriorDirectionalSnapshots,
    requireBreakOfProtectedSwing: input.requireBreakOfProtectedSwing ?? DEFAULT_MARKET_STRUCTURE_SHIFT_CONFIG.requireBreakOfProtectedSwing,
    protectedSwingPolicy: input.protectedSwingPolicy ?? DEFAULT_MARKET_STRUCTURE_SHIFT_CONFIG.protectedSwingPolicy,
    requireDisplacement: input.requireDisplacement ?? DEFAULT_MARKET_STRUCTURE_SHIFT_CONFIG.requireDisplacement,
    minimumBreakDistanceAbsolute: input.minimumBreakDistanceAbsolute ?? DEFAULT_MARKET_STRUCTURE_SHIFT_CONFIG.minimumBreakDistanceAbsolute,
    minimumBreakDistanceRelative: input.minimumBreakDistanceRelative ?? DEFAULT_MARKET_STRUCTURE_SHIFT_CONFIG.minimumBreakDistanceRelative,
    minimumBreakDistanceAtrMultiple: input.minimumBreakDistanceAtrMultiple ?? DEFAULT_MARKET_STRUCTURE_SHIFT_CONFIG.minimumBreakDistanceAtrMultiple,
    atrPeriod: input.atrPeriod ?? DEFAULT_MARKET_STRUCTURE_SHIFT_CONFIG.atrPeriod,
    duplicatePolicy: input.duplicatePolicy ?? DEFAULT_MARKET_STRUCTURE_SHIFT_CONFIG.duplicatePolicy,
    transitionResetPolicy: input.transitionResetPolicy ?? DEFAULT_MARKET_STRUCTURE_SHIFT_CONFIG.transitionResetPolicy,
  };
  if (!['MSS_ONLY', 'CHOCH_FIRST_THEN_MSS'].includes(config.terminologyMode)) throw new MarketStructureShiftError('INVALID_CONFIGURATION', 'Unknown terminologyMode.');
  if (!Number.isInteger(config.minimumPriorDirectionalSnapshots) || config.minimumPriorDirectionalSnapshots < 1) throw new MarketStructureShiftError('INVALID_CONFIGURATION', 'minimumPriorDirectionalSnapshots must be a positive integer.');
  if (!['LATEST_OPPOSING_STRUCTURAL_SWING', 'LAST_HL_FOR_BULLISH_LAST_LH_FOR_BEARISH'].includes(config.protectedSwingPolicy)) throw new MarketStructureShiftError('INVALID_CONFIGURATION', 'Unknown protectedSwingPolicy.');
  for (const [name, value] of Object.entries({ minimumBreakDistanceAbsolute: config.minimumBreakDistanceAbsolute, minimumBreakDistanceRelative: config.minimumBreakDistanceRelative, minimumBreakDistanceAtrMultiple: config.minimumBreakDistanceAtrMultiple })) {
    if (!Number.isFinite(value) || value < 0) throw new MarketStructureShiftError('INVALID_CONFIGURATION', `${name} must be non-negative and finite.`);
  }
  if (!Number.isInteger(config.atrPeriod) || config.atrPeriod < 1) throw new MarketStructureShiftError('INVALID_CONFIGURATION', 'atrPeriod must be a positive integer.');
  if (!['ONE_SHIFT_PER_PRIOR_BIAS_REGIME', 'ALLOW_MULTIPLE'].includes(config.duplicatePolicy)) throw new MarketStructureShiftError('INVALID_CONFIGURATION', 'Unknown duplicatePolicy.');
  if (!['AFTER_OPPOSITE_BIAS_CONFIRMED', 'AFTER_NEW_DIRECTIONAL_STRUCTURE'].includes(config.transitionResetPolicy)) throw new MarketStructureShiftError('INVALID_CONFIGURATION', 'Unknown transitionResetPolicy.');
  return deepFreeze(config);
}

function timestamp(value: string, subject: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new MarketStructureShiftError(subject === 'BOS' ? 'INVALID_BOS_EVENT' : subject === 'SNAPSHOT' ? 'INVALID_SNAPSHOT' : subject === 'SWING' ? 'INVALID_SWING' : 'INVALID_CANDLES', `${subject} timestamp is invalid.`);
  return parsed;
}

function normalizeBos(events: readonly BreakOfStructureEvent[]): BreakOfStructureEvent[] {
  const ids = new Set<string>();
  for (const event of events) {
    if (!event.id || ids.has(event.id)) throw new MarketStructureShiftError(ids.has(event.id) ? 'DUPLICATE_BOS_ID' : 'INVALID_BOS_EVENT', `Invalid or duplicate BOS ID: ${event.id}.`);
    ids.add(event.id);
    timestamp(event.breakoutOpenedAt, 'BOS');
    if (timestamp(event.detectedAt, 'BOS') <= timestamp(event.breakoutOpenedAt, 'BOS')) throw new MarketStructureShiftError('INVALID_BOS_EVENT', 'BOS detectedAt must follow breakoutOpenedAt.');
    if (!['BULLISH', 'BEARISH'].includes(event.direction) || !Number.isFinite(event.breakDistance) || !Number.isFinite(event.breakDistanceRelative)) throw new MarketStructureShiftError('INVALID_BOS_EVENT', 'BOS direction or distance is invalid.');
  }
  return [...events].sort((a, b) => timestamp(a.detectedAt, 'BOS') - timestamp(b.detectedAt, 'BOS') || a.id.localeCompare(b.id));
}

function normalizeSnapshots(values: readonly StructureSnapshot[]): StructureSnapshot[] {
  const ids = new Set<string>();
  for (const value of values) {
    if (!value.id || ids.has(value.id) || value.processedAt === null) throw new MarketStructureShiftError(ids.has(value.id) ? 'DUPLICATE_SNAPSHOT_ID' : 'INVALID_SNAPSHOT', `Invalid or duplicate structure snapshot ID: ${value.id}.`);
    ids.add(value.id);
    timestamp(value.processedAt, 'SNAPSHOT');
  }
  return [...values].sort((a, b) => timestamp(a.processedAt!, 'SNAPSHOT') - timestamp(b.processedAt!, 'SNAPSHOT') || a.id.localeCompare(b.id));
}

function normalizeSwings(values: readonly ConfirmedSwing[]): ConfirmedSwing[] {
  const ids = new Set<string>();
  for (const value of values) {
    if (!value.id || ids.has(value.id) || !Number.isFinite(value.price) || value.price <= 0) throw new MarketStructureShiftError(ids.has(value.id) ? 'DUPLICATE_SWING_ID' : 'INVALID_SWING', `Invalid or duplicate confirmed swing ID: ${value.id}.`);
    ids.add(value.id);
    if (timestamp(value.confirmedAt, 'SWING') < timestamp(value.pivotAt, 'SWING')) throw new MarketStructureShiftError('INVALID_SWING', 'Swing confirmedAt cannot precede pivotAt.');
  }
  return [...values].sort((a, b) => timestamp(a.confirmedAt, 'SWING') - timestamp(b.confirmedAt, 'SWING') || a.id.localeCompare(b.id));
}

function normalizeCandles(values: readonly NormalizedCandle[]): NormalizedCandle[] {
  const ordered = [...values].sort((a, b) => timestamp(a.openedAt, 'CANDLE') - timestamp(b.openedAt, 'CANDLE'));
  const ids = new Set<string>();
  for (const candle of ordered) {
    if (ids.has(candle.openedAt)) throw new MarketStructureShiftError('DUPLICATE_CANDLE', `Duplicate candle openedAt: ${candle.openedAt}.`);
    ids.add(candle.openedAt);
  }
  const completed = ordered.filter((candle) => candle.complete);
  const validation = validateCandles(completed);
  if (!validation.valid) throw new MarketStructureShiftError('INVALID_CANDLES', validation.issues.map((issue) => issue.message).join(' '));
  return completed;
}

function protectedSwing(snapshot: StructureSnapshot, config: MarketStructureShiftConfig): ClassifiedSwing | null {
  const candidate = snapshot.bias === 'BULLISH' ? snapshot.lastConfirmedLow : snapshot.bias === 'BEARISH' ? snapshot.lastConfirmedHigh : null;
  if (!candidate?.accepted) return null;
  if (config.protectedSwingPolicy === 'LAST_HL_FOR_BULLISH_LAST_LH_FOR_BEARISH') {
    const required = snapshot.bias === 'BULLISH' ? 'HL' : 'LH';
    return candidate.label === required ? candidate : null;
  }
  return candidate;
}

function directionalCount(snapshots: readonly StructureSnapshot[], snapshot: StructureSnapshot): number {
  const eligible = snapshots.filter((value) => timestamp(value.processedAt!, 'SNAPSHOT') <= timestamp(snapshot.processedAt!, 'SNAPSHOT'));
  let count = 0;
  for (let index = eligible.length - 1; index >= 0; index--) {
    if (eligible[index]!.bias !== snapshot.bias) break;
    count++;
  }
  return count;
}

function regimeId(snapshot: StructureSnapshot, snapshots: readonly StructureSnapshot[]): string {
  const eligible = snapshots.filter((value) => timestamp(value.processedAt!, 'SNAPSHOT') <= timestamp(snapshot.processedAt!, 'SNAPSHOT'));
  let start = snapshot;
  for (let index = eligible.length - 2; index >= 0; index--) {
    if (eligible[index]!.bias !== snapshot.bias) break;
    start = eligible[index]!;
  }
  return `structure-transition-regime:${stableFingerprint({ version: MARKET_STRUCTURE_SHIFT_VERSION, priorBias: snapshot.bias, startSnapshotId: start.id })}`;
}

type TransitionState = { shiftedProtectedSwingIds: Set<string>; acceptedShiftCount: number };

function makeEvent(args: {
  bos: BreakOfStructureEvent; snapshot: StructureSnapshot | null; protectedLevel: ClassifiedSwing | null; classification: StructureTransitionClassification;
  accepted: boolean; rejectionReason: string | null; directionalCount: number; regime: string | null; atrMultiple: number | null; evidence: string[];
  config: MarketStructureShiftConfig;
}): MarketStructureShiftEvent {
  const identity = { version: MARKET_STRUCTURE_SHIFT_VERSION, sourceBosEventId: args.bos.id, priorStructureSnapshotId: args.snapshot?.id ?? null, protectedSwingId: args.protectedLevel?.swing.id ?? null, classification: args.classification, accepted: args.accepted, rejectionReason: args.rejectionReason, transitionRegimeId: args.regime, configuration: args.config };
  const fingerprint = stableFingerprint(identity);
  return deepFreeze({
    id: `market-structure-shift:${fingerprint}`,
    version: MARKET_STRUCTURE_SHIFT_VERSION,
    classification: args.classification,
    direction: args.bos.direction,
    sourceBosEventId: args.bos.id,
    sourceSwingId: args.bos.sourceSwingId,
    priorStructureSnapshotId: args.snapshot?.id ?? null,
    priorBias: args.snapshot?.bias ?? args.bos.priorStructureBias,
    protectedSwingId: args.protectedLevel?.swing.id ?? null,
    protectedSwingPrice: args.protectedLevel?.swing.price ?? null,
    protectedSwingLabel: args.protectedLevel?.label ?? null,
    detectedAt: args.bos.detectedAt,
    breakDistance: args.bos.breakDistance,
    breakDistanceRelative: args.bos.breakDistanceRelative,
    breakDistanceAtrMultiple: args.atrMultiple,
    priorDirectionalSnapshotCount: args.directionalCount,
    transitionRegimeId: args.regime,
    accepted: args.accepted,
    rejectionReason: args.rejectionReason,
    evidence: args.evidence,
    fingerprint,
  });
}

export function classifyMarketStructureTransitions(input: MarketStructureShiftInput): MarketStructureShiftResult {
  const configuration = normalizeConfig(input.config);
  const bosEvents = normalizeBos(input.bosEvents);
  const snapshots = normalizeSnapshots(input.structureSnapshots);
  const swings = normalizeSwings(input.confirmedSwings);
  const swingIds = new Set(swings.map((swing) => swing.id));
  const candles = normalizeCandles(input.candles ?? []);
  const events: MarketStructureShiftEvent[] = [];
  const rejectedCandidates: MarketStructureShiftEvent[] = [];
  const warnings: string[] = [];
  const regimes = new Map<string, TransitionState>();

  for (const bos of bosEvents) {
    const snapshot = snapshots.find((value) => value.id === bos.sourceSnapshotId) ?? null;
    let reason: string | null = null;
    if (!bos.accepted) reason = 'SOURCE_BOS_NOT_ACCEPTED';
    else if (!snapshot) reason = 'PRIOR_SNAPSHOT_UNAVAILABLE';
    else if (timestamp(snapshot.processedAt!, 'SNAPSHOT') > timestamp(bos.breakoutOpenedAt, 'BOS')) reason = 'PRIOR_SNAPSHOT_NOT_AVAILABLE_BEFORE_BREAKOUT';
    else if (snapshot.id !== bos.sourceSnapshotId) reason = 'SOURCE_SNAPSHOT_MISMATCH';
    const count = snapshot ? directionalCount(snapshots, snapshot) : 0;
    const directional = snapshot?.bias === 'BULLISH' || snapshot?.bias === 'BEARISH';
    const counter = directional && bos.direction !== snapshot!.bias;
    const aligned = directional && bos.direction === snapshot!.bias;
    const protectedLevel = snapshot ? protectedSwing(snapshot, configuration) : null;
    const regime = directional ? regimeId(snapshot!, snapshots) : null;
    let atrMultiple: number | null = null;
    if (!reason && configuration.requireEstablishedBias && !directional) reason = `PRIOR_BIAS_${snapshot!.bias}`;
    if (!reason && directional && count < configuration.minimumPriorDirectionalSnapshots) reason = 'INSUFFICIENT_PRIOR_DIRECTIONAL_SNAPSHOTS';
    if (!reason && counter && configuration.requireBreakOfProtectedSwing && !protectedLevel) reason = 'PROTECTED_SWING_UNAVAILABLE';
    if (!reason && counter && protectedLevel && timestamp(protectedLevel.swing.confirmedAt, 'SWING') > timestamp(bos.breakoutOpenedAt, 'BOS')) reason = 'PROTECTED_SWING_NOT_CONFIRMED_BEFORE_BREAKOUT';
    if (!reason && counter && configuration.requireBreakOfProtectedSwing && protectedLevel?.swing.id !== bos.sourceSwingId) reason = 'BOS_DID_NOT_BREAK_PROTECTED_SWING';
    if (!reason && !swingIds.has(bos.sourceSwingId)) reason = 'SOURCE_SWING_UNAVAILABLE';
    if (!reason && counter && configuration.requireDisplacement) {
      const source = candles.filter((candle) => timestamp(candle.closedAt, 'CANDLE') <= timestamp(bos.detectedAt, 'BOS'));
      const atr = simpleAtr(source, configuration.atrPeriod);
      if (!atr.sufficientData || atr.value === null) reason = 'INSUFFICIENT_ATR_HISTORY';
      else {
        atrMultiple = bos.breakDistance / atr.value;
        if (bos.breakDistance < configuration.minimumBreakDistanceAbsolute) reason = 'ABSOLUTE_BREAK_DISTANCE_BELOW_MINIMUM';
        else if (bos.breakDistanceRelative < configuration.minimumBreakDistanceRelative) reason = 'RELATIVE_BREAK_DISTANCE_BELOW_MINIMUM';
        else if (atrMultiple < configuration.minimumBreakDistanceAtrMultiple) reason = 'ATR_BREAK_DISTANCE_BELOW_MINIMUM';
      }
    }

    let classification: StructureTransitionClassification = 'UNCLASSIFIED';
    const evidence: string[] = [];
    if (snapshot) evidence.push(`Prior structure bias was ${snapshot.bias}.`);
    if (!reason && aligned) {
      classification = 'CONTINUATION_BREAK';
      evidence.push(`${bos.direction === 'BULLISH' ? 'Bullish' : 'Bearish'} BOS aligned with prior ${snapshot!.bias} structure and was classified CONTINUATION_BREAK.`);
    } else if (!reason && counter) {
      const state = regimes.get(regime!) ?? { shiftedProtectedSwingIds: new Set<string>(), acceptedShiftCount: 0 };
      if (configuration.duplicatePolicy === 'ONE_SHIFT_PER_PRIOR_BIAS_REGIME' && protectedLevel && state.shiftedProtectedSwingIds.has(protectedLevel.swing.id)) reason = 'DUPLICATE_PROTECTED_SWING_SHIFT';
      else {
        classification = configuration.terminologyMode === 'MSS_ONLY' || state.acceptedShiftCount > 0 ? 'MARKET_STRUCTURE_SHIFT' : 'CHOCH';
        evidence.push(`${bos.direction === 'BEARISH' ? 'Bearish' : 'Bullish'} BOS broke protected ${protectedLevel!.label} at ${protectedLevel!.swing.price}.`);
        if (classification === 'CHOCH') evidence.push(`This was the first accepted counter-structure break in the current ${snapshot!.bias.toLowerCase()} regime.`);
        evidence.push(classification === 'CHOCH' ? `Classified CHOCH; this indicates transition risk, not confirmed ${bos.direction.toLowerCase()} trend.` : 'Classified MARKET_STRUCTURE_SHIFT; this is confirmed counter-structure evidence, not reversal certainty.');
        state.acceptedShiftCount++;
        if (protectedLevel) state.shiftedProtectedSwingIds.add(protectedLevel.swing.id);
        regimes.set(regime!, state);
      }
    }
    if (reason) evidence.push(`Candidate was not classified: ${reason}.`);
    const event = makeEvent({ bos, snapshot, protectedLevel, classification, accepted: reason === null, rejectionReason: reason, directionalCount: count, regime, atrMultiple, evidence, config: configuration });
    (event.accepted ? events : rejectedCandidates).push(event);
  }
  return deepFreeze({ classifierVersion: MARKET_STRUCTURE_SHIFT_VERSION, events, rejectedCandidates, warnings, configuration });
}

export function createMarketStructureShiftClassifier(input: Partial<MarketStructureShiftConfig> = {}): IncrementalMarketStructureShiftClassifier {
  const configuration = normalizeConfig(input);
  const bosEvents: BreakOfStructureEvent[] = [], snapshots: StructureSnapshot[] = [], swings: ConfirmedSwing[] = [], candles: NormalizedCandle[] = [];
  let result = classifyMarketStructureTransitions({ bosEvents, structureSnapshots: snapshots, confirmedSwings: swings, candles, config: configuration });
  let newEvents: MarketStructureShiftEvent[] = [];
  let lastBosTime = -Infinity;
  const recompute = () => { result = classifyMarketStructureTransitions({ bosEvents, structureSnapshots: snapshots, confirmedSwings: swings, candles, config: configuration }); };
  const api: IncrementalMarketStructureShiftClassifier = {
    pushConfirmedSwing(swing) {
      if (swings.some((value) => value.id === swing.id)) throw new MarketStructureShiftError('DUPLICATE_SWING_ID', `Duplicate confirmed swing ID: ${swing.id}.`);
      const time = timestamp(swing.confirmedAt, 'SWING');
      if (swings.at(-1) && time < timestamp(swings.at(-1)!.confirmedAt, 'SWING')) throw new MarketStructureShiftError('OUT_OF_ORDER_INCREMENTAL_INPUT', 'Incremental confirmed swings must not move backward.');
      if (time <= lastBosTime) throw new MarketStructureShiftError('LATE_INCREMENTAL_INFORMATION', 'Confirmed swing cannot be inserted into already classified history.');
      swings.push(deepFreeze(structuredClone(swing)));
    },
    pushStructureSnapshot(snapshot) {
      if (snapshots.some((value) => value.id === snapshot.id)) throw new MarketStructureShiftError('DUPLICATE_SNAPSHOT_ID', `Duplicate structure snapshot ID: ${snapshot.id}.`);
      if (snapshot.processedAt === null) throw new MarketStructureShiftError('INVALID_SNAPSHOT', 'Incremental snapshot requires processedAt.');
      const time = timestamp(snapshot.processedAt, 'SNAPSHOT');
      if (snapshots.at(-1) && time < timestamp(snapshots.at(-1)!.processedAt!, 'SNAPSHOT')) throw new MarketStructureShiftError('OUT_OF_ORDER_INCREMENTAL_INPUT', 'Incremental snapshots must not move backward.');
      if (time <= lastBosTime) throw new MarketStructureShiftError('LATE_INCREMENTAL_INFORMATION', 'Structure snapshot cannot be inserted into already classified history.');
      snapshots.push(deepFreeze(structuredClone(snapshot)));
    },
    pushBosEvent(event) {
      if (bosEvents.some((value) => value.id === event.id)) throw new MarketStructureShiftError('DUPLICATE_BOS_ID', `Duplicate BOS ID: ${event.id}.`);
      const time = timestamp(event.detectedAt, 'BOS');
      if (time < lastBosTime) throw new MarketStructureShiftError('OUT_OF_ORDER_INCREMENTAL_INPUT', 'Incremental BOS events must not move backward.');
      const previous = new Set(result.events.map((value) => value.fingerprint));
      bosEvents.push(deepFreeze(structuredClone(event)));
      lastBosTime = time;
      recompute();
      newEvents = result.events.filter((value) => !previous.has(value.fingerprint));
      return deepFreeze([...newEvents]);
    },
    pushCandle(candle) {
      const time = timestamp(candle.closedAt, 'CANDLE');
      if (candles.at(-1) && timestamp(candle.openedAt, 'CANDLE') <= timestamp(candles.at(-1)!.openedAt, 'CANDLE')) throw new MarketStructureShiftError('OUT_OF_ORDER_INCREMENTAL_INPUT', 'Incremental candles must have unique ascending openedAt.');
      if (time <= lastBosTime) throw new MarketStructureShiftError('LATE_INCREMENTAL_INFORMATION', 'Candle cannot be inserted into already classified history.');
      candles.push(deepFreeze(structuredClone(candle)));
    },
    getNewEvents() { const value = deepFreeze([...newEvents]); newEvents = []; return value; },
    getAllEvents() { return deepFreeze([...result.events]); },
    getRejectedCandidates() { return deepFreeze([...result.rejectedCandidates]); },
    getWarnings() { return deepFreeze([...result.warnings]); },
    getResult() { return result; },
    reset() { bosEvents.length = snapshots.length = swings.length = candles.length = 0; lastBosTime = -Infinity; newEvents = []; recompute(); },
  };
  return Object.freeze(api);
}

export function serializeMarketStructureShiftResult(result: MarketStructureShiftResult): string {
  return canonicalStringify(result);
}
