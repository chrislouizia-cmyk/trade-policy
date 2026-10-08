import { validateCandles } from '../../analysis-utils/index.ts';
import type { NormalizedCandle } from '../../contracts.ts';
import type { ConfirmedSwing } from '../../detectors/confirmed-swing/confirmed-swing-types.ts';
import { canonicalStringify, stableFingerprint } from '../../serialization/stable-fingerprint.ts';
import type { BreakOfStructureEvent } from '../../structure/break-of-structure/break-of-structure-types.ts';
import type { ClassifiedSwing, StructureSnapshot, SwingStructureLabel } from '../../structure/structure-types.ts';
import type { StructuralLiquiditySweepEvent } from '../structural-sweep/structural-liquidity-sweep-types.ts';
import type { IncrementalStructuralLiquidityTargetDetector, LiquidityTargetCandidate, LiquidityTargetLifecycleEvent, LiquidityTargetLifecycleEventType, LiquidityTargetSide, LiquidityTargetStatus, LiquidityTargetType, RankedLiquidityTarget, RankLiquidityTargetsInput, StructuralLiquidityTarget, StructuralLiquidityTargetConfig, StructuralLiquidityTargetInput, StructuralLiquidityTargetResult } from './structural-liquidity-target-types.ts';

export const STRUCTURAL_LIQUIDITY_TARGET_VERSION = '1.0.0';
const HIGH_LABELS: SwingStructureLabel[] = ['INITIAL_HIGH', 'HH', 'LH', 'EH'];
const LOW_LABELS: SwingStructureLabel[] = ['INITIAL_LOW', 'HL', 'LL', 'EL'];
const isTerminal = (status: LiquidityTargetStatus): boolean => ['SWEPT', 'BROKEN', 'INVALIDATED', 'EXPIRED'].includes(status);

export const DEFAULT_STRUCTURAL_LIQUIDITY_TARGET_CONFIG: StructuralLiquidityTargetConfig = Object.freeze({
  sourceEligibility: 'UNBROKEN_ACCEPTED_ONLY', allowedHighLabels: Object.freeze([...HIGH_LABELS]), allowedLowLabels: Object.freeze([...LOW_LABELS]),
  equalityToleranceAbsolute: 0, equalityToleranceRelative: 0, equalLevelMinimumMembers: 2, touchToleranceAbsolute: 0, touchToleranceRelative: 0,
  clusterPolicy: 'KEEP_INDIVIDUAL_AND_CLUSTER', bosConsumptionPolicy: 'MARK_BROKEN', sweepConsumptionPolicy: 'MARK_SWEPT',
  structuralReplacementPolicy: 'KEEP_ALL_HISTORY', expirationPolicy: 'NEVER', expirationCandles: 0, expirationMilliseconds: 0,
  proximityRankingMode: 'ABSOLUTE_DISTANCE', atrPeriod: 14,
}) as StructuralLiquidityTargetConfig;

export class StructuralLiquidityTargetError extends Error {
  readonly code: 'INVALID_CONFIGURATION' | 'INVALID_SWING' | 'INVALID_SNAPSHOT' | 'INVALID_BOS_EVENT' | 'INVALID_SWEEP_EVENT' | 'INVALID_CANDLES' | 'DUPLICATE_SWING_ID' | 'DUPLICATE_SNAPSHOT_ID' | 'DUPLICATE_BOS_ID' | 'DUPLICATE_SWEEP_ID' | 'DUPLICATE_CANDLE' | 'OUT_OF_ORDER_INCREMENTAL_INPUT' | 'LATE_INCREMENTAL_INFORMATION';
  constructor(code: StructuralLiquidityTargetError['code'], message: string) { super(message); this.name = 'StructuralLiquidityTargetError'; this.code = code; }
}
function deepFreeze<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); } return value; }
function ts(value: string, code: StructuralLiquidityTargetError['code'], subject: string): number { const result = Date.parse(value); if (!Number.isFinite(result)) throw new StructuralLiquidityTargetError(code, `${subject} timestamp is invalid.`); return result; }

function configFor(input: Partial<StructuralLiquidityTargetConfig> = {}): StructuralLiquidityTargetConfig {
  const config: StructuralLiquidityTargetConfig = {
    sourceEligibility: input.sourceEligibility ?? 'UNBROKEN_ACCEPTED_ONLY', allowedHighLabels: [...(input.allowedHighLabels ?? HIGH_LABELS)], allowedLowLabels: [...(input.allowedLowLabels ?? LOW_LABELS)],
    equalityToleranceAbsolute: input.equalityToleranceAbsolute ?? 0, equalityToleranceRelative: input.equalityToleranceRelative ?? 0,
    equalLevelMinimumMembers: input.equalLevelMinimumMembers ?? 2, touchToleranceAbsolute: input.touchToleranceAbsolute ?? 0, touchToleranceRelative: input.touchToleranceRelative ?? 0,
    clusterPolicy: input.clusterPolicy ?? 'KEEP_INDIVIDUAL_AND_CLUSTER', bosConsumptionPolicy: input.bosConsumptionPolicy ?? 'MARK_BROKEN',
    sweepConsumptionPolicy: input.sweepConsumptionPolicy ?? 'MARK_SWEPT', structuralReplacementPolicy: input.structuralReplacementPolicy ?? 'KEEP_ALL_HISTORY',
    expirationPolicy: input.expirationPolicy ?? 'NEVER', expirationCandles: input.expirationCandles ?? 0, expirationMilliseconds: input.expirationMilliseconds ?? 0,
    proximityRankingMode: input.proximityRankingMode ?? 'ABSOLUTE_DISTANCE', atrPeriod: input.atrPeriod ?? 14,
  };
  for (const [key, value] of Object.entries({ equalityToleranceAbsolute: config.equalityToleranceAbsolute, equalityToleranceRelative: config.equalityToleranceRelative, touchToleranceAbsolute: config.touchToleranceAbsolute, touchToleranceRelative: config.touchToleranceRelative, expirationMilliseconds: config.expirationMilliseconds })) if (!Number.isFinite(value) || value < 0) throw new StructuralLiquidityTargetError('INVALID_CONFIGURATION', `${key} must be non-negative and finite.`);
  if (!Number.isInteger(config.equalLevelMinimumMembers) || config.equalLevelMinimumMembers < 2 || !Number.isInteger(config.expirationCandles) || config.expirationCandles < 0 || !Number.isInteger(config.atrPeriod) || config.atrPeriod < 1) throw new StructuralLiquidityTargetError('INVALID_CONFIGURATION', 'Member, expiration, and ATR counts must be valid integers.');
  if (config.allowedHighLabels.some((label) => !HIGH_LABELS.includes(label)) || config.allowedLowLabels.some((label) => !LOW_LABELS.includes(label))) throw new StructuralLiquidityTargetError('INVALID_CONFIGURATION', 'Allowed labels must match structural direction.');
  if (!['ALL_ACCEPTED_STRUCTURE', 'LATEST_PER_DIRECTION', 'UNBROKEN_ACCEPTED_ONLY'].includes(config.sourceEligibility)
    || !['KEEP_INDIVIDUAL_AND_CLUSTER', 'CLUSTER_ONLY', 'INDIVIDUAL_ONLY'].includes(config.clusterPolicy)
    || !['MARK_BROKEN', 'MARK_INVALIDATED'].includes(config.bosConsumptionPolicy)
    || !['MARK_SWEPT', 'KEEP_AVAILABLE_AFTER_SWEEP'].includes(config.sweepConsumptionPolicy)
    || !['KEEP_ALL_HISTORY', 'INVALIDATE_SUPERSEDED_LATEST'].includes(config.structuralReplacementPolicy)
    || !['NEVER', 'AFTER_N_CANDLES', 'AFTER_N_MILLISECONDS'].includes(config.expirationPolicy)
    || !['ABSOLUTE_DISTANCE', 'RELATIVE_DISTANCE', 'ATR_NORMALIZED_DISTANCE'].includes(config.proximityRankingMode)) throw new StructuralLiquidityTargetError('INVALID_CONFIGURATION', 'Unknown target policy.');
  if (config.expirationPolicy === 'AFTER_N_CANDLES' && config.expirationCandles < 1) throw new StructuralLiquidityTargetError('INVALID_CONFIGURATION', 'Candle expiration requires a positive count.');
  if (config.expirationPolicy === 'AFTER_N_MILLISECONDS' && config.expirationMilliseconds <= 0) throw new StructuralLiquidityTargetError('INVALID_CONFIGURATION', 'Time expiration requires a positive duration.');
  return deepFreeze(config);
}

function normalizeUnique<T>(values: readonly T[], id: (value: T) => string, time: (value: T) => number, duplicateCode: StructuralLiquidityTargetError['code'], invalidCode: StructuralLiquidityTargetError['code']): T[] {
  const seen = new Set<string>();
  for (const value of values) { const key = id(value); if (!key || seen.has(key)) throw new StructuralLiquidityTargetError(seen.has(key) ? duplicateCode : invalidCode, `Invalid or duplicate ID: ${key}.`); seen.add(key); time(value); }
  return [...values].sort((a, b) => time(a) - time(b) || id(a).localeCompare(id(b)));
}
function normalizeCandles(values: readonly NormalizedCandle[], warnings: string[]): NormalizedCandle[] {
  const ordered = [...values].sort((a, b) => ts(a.openedAt, 'INVALID_CANDLES', 'Candle') - ts(b.openedAt, 'INVALID_CANDLES', 'Candle')), seen = new Set<string>();
  for (const candle of ordered) { if (seen.has(candle.openedAt)) throw new StructuralLiquidityTargetError('DUPLICATE_CANDLE', `Duplicate candle: ${candle.openedAt}.`); seen.add(candle.openedAt); if ([candle.open, candle.high, candle.low, candle.close].some((v) => !Number.isFinite(v) || v <= 0)) throw new StructuralLiquidityTargetError('INVALID_CANDLES', 'OHLC must be positive and finite.'); if (ts(candle.closedAt, 'INVALID_CANDLES', 'Candle') <= ts(candle.openedAt, 'INVALID_CANDLES', 'Candle')) throw new StructuralLiquidityTargetError('INVALID_CANDLES', 'Candle close must follow open.'); }
  const complete = ordered.filter((candle) => { if (candle.complete) return true; warnings.push(`Ignored incomplete candle at ${candle.openedAt}.`); return false; });
  const validation = validateCandles(complete); if (!validation.valid) throw new StructuralLiquidityTargetError('INVALID_CANDLES', validation.issues.map((issue) => issue.message).join(' ')); return complete;
}
type Source = { classified: ClassifiedSwing; snapshotId: string };
function acceptedSources(snapshots: readonly StructureSnapshot[], swingIds: Set<string>, config: StructuralLiquidityTargetConfig): Source[] {
  const map = new Map<string, Source>();
  for (const snapshot of snapshots) for (const classified of [snapshot.previousConfirmedHigh, snapshot.lastConfirmedHigh, snapshot.previousConfirmedLow, snapshot.lastConfirmedLow]) if (classified?.accepted && swingIds.has(classified.swing.id) && !map.has(classified.swing.id)) map.set(classified.swing.id, { classified, snapshotId: snapshot.id });
  let values = [...map.values()].filter(({ classified }) => classified.swing.direction === 'HIGH' ? config.allowedHighLabels.includes(classified.label) : config.allowedLowLabels.includes(classified.label))
    .sort((a, b) => ts(a.classified.swing.confirmedAt, 'INVALID_SWING', 'Swing') - ts(b.classified.swing.confirmedAt, 'INVALID_SWING', 'Swing') || a.classified.swing.id.localeCompare(b.classified.swing.id));
  if (config.sourceEligibility === 'LATEST_PER_DIRECTION') values = ['HIGH', 'LOW'].flatMap((direction) => values.filter((value) => value.classified.swing.direction === direction).slice(-1));
  return values;
}
const tol = (a: number, b: number, abs: number, rel: number): number => Math.max(abs, Math.max(Math.abs(a), Math.abs(b)) * rel);
function targetIdentity(type: LiquidityTargetType, side: LiquidityTargetSide, swingIds: string[], snapshotIds: string[], price: number, lower: number, upper: number, detectedAt: string, config: StructuralLiquidityTargetConfig): { id: string; fingerprint: string } {
  const identity = { version: STRUCTURAL_LIQUIDITY_TARGET_VERSION, type, side, swingIds, snapshotIds, price, lower, upper, detectedAt, config }; const fingerprint = stableFingerprint(identity); return { id: `structural-liquidity-target:${fingerprint}`, fingerprint };
}
function makeTarget(sources: Source[], type: LiquidityTargetType, config: StructuralLiquidityTargetConfig): StructuralLiquidityTarget {
  const ordered = [...sources].sort((a, b) => ts(a.classified.swing.confirmedAt, 'INVALID_SWING', 'Swing') - ts(b.classified.swing.confirmedAt, 'INVALID_SWING', 'Swing') || a.classified.swing.id.localeCompare(b.classified.swing.id));
  const side: LiquidityTargetSide = ordered[0]!.classified.swing.direction === 'HIGH' ? 'BUY_SIDE' : 'SELL_SIDE';
  const prices = ordered.map((value) => value.classified.swing.price), price = prices.reduce((sum, value) => sum + value, 0) / prices.length;
  const boundaryTolerance = Math.max(config.equalityToleranceAbsolute, Math.abs(price) * config.equalityToleranceRelative), detectedAt = ordered[config.equalLevelMinimumMembers - 1]?.classified.swing.confirmedAt ?? ordered.at(-1)!.classified.swing.confirmedAt;
  const swingIds = ordered.map((value) => value.classified.swing.id), snapshotIds = [...new Set(ordered.map((value) => value.snapshotId))].sort();
  const identitySources = type.startsWith('EQUAL') ? ordered.slice(0, config.equalLevelMinimumMembers) : ordered;
  const identityPrice = identitySources.reduce((sum, value) => sum + value.classified.swing.price, 0) / identitySources.length;
  const identityTolerance = Math.max(config.equalityToleranceAbsolute, Math.abs(identityPrice) * config.equalityToleranceRelative);
  const identity = targetIdentity(type, side, identitySources.map((value) => value.classified.swing.id), [...new Set(identitySources.map((value) => value.snapshotId))].sort(), identityPrice, identityPrice - identityTolerance, identityPrice + identityTolerance, detectedAt, config);
  return deepFreeze({
    id: identity.id, version: STRUCTURAL_LIQUIDITY_TARGET_VERSION, side, targetType: type, status: 'AVAILABLE', price, lowerBoundary: price - boundaryTolerance, upperBoundary: price + boundaryTolerance,
    sourceSwingIds: swingIds, sourceSwingLabels: ordered.map((value) => value.classified.label), sourceSnapshotIds: snapshotIds, memberCount: ordered.length,
    earliestPivotAt: ordered[0]!.classified.swing.pivotAt, latestPivotAt: ordered.at(-1)!.classified.swing.pivotAt, confirmedAt: ordered.at(-1)!.classified.swing.confirmedAt, detectedAt,
    firstTestedAt: null, sweptAt: null, brokenAt: null, invalidatedAt: null, expiredAt: null, consumingSweepEventIds: [], consumingBosEventIds: [],
    evidence: [type.startsWith('EQUAL') ? `${type === 'EQUAL_HIGHS' ? 'Equal-high' : 'Equal-low'} cluster became available after ${config.equalLevelMinimumMembers} confirmed structural levels.` : `${side === 'BUY_SIDE' ? 'Buy-side' : 'Sell-side'} liquidity target created from confirmed ${ordered[0]!.classified.label} at ${price}.`, 'This target is a structural market fact, not a take-profit recommendation.'],
    lifecycleEventIds: [], fingerprint: stableFingerprint({ version: STRUCTURAL_LIQUIDITY_TARGET_VERSION, type, side, swingIds, snapshotIds, price, lowerBoundary: price - boundaryTolerance, upperBoundary: price + boundaryTolerance, detectedAt, config }),
  });
}
function lifecycle(target: StructuralLiquidityTarget, type: LiquidityTargetLifecycleEventType, detectedAt: string, status: LiquidityTargetStatus, evidence: string[], trigger: { candle?: NormalizedCandle; candleIndex?: number; bos?: BreakOfStructureEvent; sweep?: StructuralLiquiditySweepEvent } = {}): LiquidityTargetLifecycleEvent {
  const identity = { version: STRUCTURAL_LIQUIDITY_TARGET_VERSION, targetId: target.id, type, detectedAt, status, candle: trigger.candle ? { ...trigger.candle, index: trigger.candleIndex } : null, bos: trigger.bos?.id ?? null, sweep: trigger.sweep?.id ?? null };
  const fingerprint = stableFingerprint(identity);
  return deepFreeze({ id: `liquidity-target-lifecycle:${fingerprint}`, version: STRUCTURAL_LIQUIDITY_TARGET_VERSION, targetId: target.id, eventType: type, detectedAt, triggeringCandleId: trigger.candle ? `candle:${stableFingerprint(trigger.candle)}` : null, triggeringCandleIndex: trigger.candleIndex ?? null, sourceBosEventId: trigger.bos?.id ?? null, sourceSweepEventId: trigger.sweep?.id ?? null, priorStatus: type === 'CREATED' ? null : target.status, newStatus: status, evidence, fingerprint });
}
function withEvent(target: StructuralLiquidityTarget, event: LiquidityTargetLifecycleEvent, updates: Partial<StructuralLiquidityTarget>): StructuralLiquidityTarget { return deepFreeze({ ...target, ...updates, lifecycleEventIds: [...target.lifecycleEventIds, event.id] }); }

function createTargets(sources: Source[], config: StructuralLiquidityTargetConfig): { targets: StructuralLiquidityTarget[]; events: LiquidityTargetLifecycleEvent[] } {
  const targets: StructuralLiquidityTarget[] = [], events: LiquidityTargetLifecycleEvent[] = [];
  if (config.clusterPolicy !== 'CLUSTER_ONLY') for (const source of sources) { const target = makeTarget([source], source.classified.swing.direction === 'HIGH' ? 'STRUCTURAL_HIGH' : 'STRUCTURAL_LOW', config); const event = lifecycle(target, 'CREATED', target.detectedAt, 'AVAILABLE', target.evidence); targets.push(withEvent(target, event, {})); events.push(event); }
  if (config.clusterPolicy !== 'INDIVIDUAL_ONLY') for (const direction of ['HIGH', 'LOW'] as const) {
    const pools: Source[][] = [];
    for (const source of sources.filter((value) => value.classified.swing.direction === direction)) {
      const pool = pools.find((members) => members.every((member) => Math.abs(member.classified.swing.price - source.classified.swing.price) <= tol(member.classified.swing.price, source.classified.swing.price, config.equalityToleranceAbsolute, config.equalityToleranceRelative)));
      (pool ?? (pools.push([]), pools.at(-1)!)).push(source);
    }
    for (const members of pools.filter((pool) => pool.length >= config.equalLevelMinimumMembers)) {
      let target = makeTarget(members, direction === 'HIGH' ? 'EQUAL_HIGHS' : 'EQUAL_LOWS', config); const created = lifecycle(target, 'CREATED', target.detectedAt, 'AVAILABLE', target.evidence); target = withEvent(target, created, {}); events.push(created);
      for (const member of members.slice(config.equalLevelMinimumMembers)) { const added = lifecycle(target, 'MEMBER_ADDED', member.classified.swing.confirmedAt, 'AVAILABLE', [`Confirmed structural level ${member.classified.swing.id} joined the existing cluster.`]); target = withEvent(target, added, {}); events.push(added); }
      targets.push(target);
    }
  }
  return { targets, events };
}

function eventTime(event: BreakOfStructureEvent | StructuralLiquiditySweepEvent): number { return ts(event.detectedAt, 'INVALID_BOS_EVENT', 'Event'); }
function bosMatches(target: StructuralLiquidityTarget, bos: BreakOfStructureEvent): boolean {
  if (!bos.accepted || !target.sourceSwingIds.includes(bos.sourceSwingId) || (target.side === 'BUY_SIDE' ? bos.direction !== 'BULLISH' : bos.direction !== 'BEARISH')) return false;
  return target.memberCount === 1 || (target.side === 'BUY_SIDE' ? bos.breakoutClose > target.upperBoundary : bos.breakoutClose < target.lowerBoundary);
}
function sweepMatches(target: StructuralLiquidityTarget, sweep: StructuralLiquiditySweepEvent): boolean {
  if (!sweep.accepted || !target.sourceSwingIds.includes(sweep.sourceSwingId) || sweep.direction !== target.side) return false;
  return target.memberCount === 1 || (target.side === 'BUY_SIDE' ? sweep.high >= target.upperBoundary : sweep.low <= target.lowerBoundary);
}

export function detectStructuralLiquidityTargets(input: StructuralLiquidityTargetInput): StructuralLiquidityTargetResult {
  const configuration = configFor(input.config), warnings: string[] = [], candles = normalizeCandles(input.candles, warnings);
  const swings = normalizeUnique(input.confirmedSwings, (v) => v.id, (v) => ts(v.confirmedAt, 'INVALID_SWING', 'Swing'), 'DUPLICATE_SWING_ID', 'INVALID_SWING');
  const snapshots = normalizeUnique(input.structureSnapshots.filter((v) => v.processedAt !== null), (v) => v.id, (v) => ts(v.processedAt!, 'INVALID_SNAPSHOT', 'Snapshot'), 'DUPLICATE_SNAPSHOT_ID', 'INVALID_SNAPSHOT');
  const bosEvents = normalizeUnique(input.bosEvents ?? [], (v) => v.id, eventTime, 'DUPLICATE_BOS_ID', 'INVALID_BOS_EVENT');
  const sweepEvents = normalizeUnique(input.sweepEvents ?? [], (v) => v.id, (v) => ts(v.detectedAt, 'INVALID_SWEEP_EVENT', 'Sweep'), 'DUPLICATE_SWEEP_ID', 'INVALID_SWEEP_EVENT');
  const sourceIds = new Set(swings.map((swing) => swing.id)), sources = acceptedSources(snapshots, sourceIds, configuration);
  let { targets, events: lifecycleEvents } = createTargets(sources, configuration);
  const rejectedCandidates: LiquidityTargetCandidate[] = [];
  if (!sources.length && (swings.length || snapshots.length)) warnings.push('No eligible accepted structural swing classifications were available.');
  const timeline = [
    ...bosEvents.map((value) => ({ kind: 'BOS' as const, at: eventTime(value), value })),
    ...sweepEvents.map((value) => ({ kind: 'SWEEP' as const, at: ts(value.detectedAt, 'INVALID_SWEEP_EVENT', 'Sweep'), value })),
    ...candles.map((value, index) => ({ kind: 'CANDLE' as const, at: ts(value.closedAt, 'INVALID_CANDLES', 'Candle'), value, index })),
  ].sort((a, b) => a.at - b.at || ({ BOS: 0, SWEEP: 1, CANDLE: 2 }[a.kind] - { BOS: 0, SWEEP: 1, CANDLE: 2 }[b.kind]) || ('id' in a.value ? a.value.id.localeCompare('id' in b.value ? b.value.id : '') : 0));
  const latest = new Map<LiquidityTargetSide, StructuralLiquidityTarget>();
  for (let index = 0; index < targets.length; index++) {
    let target = targets[index]!;
    if (target.memberCount === 1 && configuration.structuralReplacementPolicy === 'INVALIDATE_SUPERSEDED_LATEST') {
      const previous = latest.get(target.side);
      if (previous && !isTerminal(previous.status)) { const event = lifecycle(previous, 'INVALIDATED', target.detectedAt, 'INVALIDATED', ['Target invalidated when a newer same-side structural target became available.']); const position = targets.findIndex((value) => value.id === previous.id); targets[position] = withEvent(previous, event, { status: 'INVALIDATED', invalidatedAt: target.detectedAt }); lifecycleEvents.push(event); }
      latest.set(target.side, target);
    }
  }
  for (const item of timeline) {
    targets = targets.map((original) => {
      let target = original;
      if (isTerminal(target.status) || item.at < ts(target.detectedAt, 'INVALID_SWING', 'Target')) return target;
      if (item.kind === 'BOS' && bosMatches(target, item.value)) {
        const status = configuration.bosConsumptionPolicy === 'MARK_BROKEN' ? 'BROKEN' : 'INVALIDATED'; const type = status;
        const event = lifecycle(target, type, item.value.detectedAt, status, [`Target was marked ${status} by accepted BOS ${item.value.id}.`], { bos: item.value }); lifecycleEvents.push(event);
        return withEvent(target, event, { status, brokenAt: status === 'BROKEN' ? item.value.detectedAt : null, invalidatedAt: status === 'INVALIDATED' ? item.value.detectedAt : null, consumingBosEventIds: [...target.consumingBosEventIds, item.value.id] });
      }
      if (item.kind === 'SWEEP' && sweepMatches(target, item.value)) {
        if (configuration.sweepConsumptionPolicy === 'KEEP_AVAILABLE_AFTER_SWEEP') return target;
        const event = lifecycle(target, 'SWEPT', item.value.detectedAt, 'SWEPT', [`Target was marked SWEPT by structural sweep event ${item.value.id}.`], { sweep: item.value }); lifecycleEvents.push(event);
        return withEvent(target, event, { status: 'SWEPT', sweptAt: item.value.detectedAt, consumingSweepEventIds: [...target.consumingSweepEventIds, item.value.id] });
      }
      if (item.kind !== 'CANDLE' || ts(target.confirmedAt, 'INVALID_SWING', 'Target') >= ts(item.value.openedAt, 'INVALID_CANDLES', 'Candle')) return target;
      const ageCandles = candles.filter((candidate) => ts(candidate.openedAt, 'INVALID_CANDLES', 'Candle') >= ts(target.confirmedAt, 'INVALID_SWING', 'Target') && ts(candidate.closedAt, 'INVALID_CANDLES', 'Candle') <= item.at).length;
      const expires = configuration.expirationPolicy === 'AFTER_N_CANDLES' ? ageCandles >= configuration.expirationCandles : configuration.expirationPolicy === 'AFTER_N_MILLISECONDS' ? item.at - ts(target.detectedAt, 'INVALID_SWING', 'Target') >= configuration.expirationMilliseconds : false;
      if (expires) { const event = lifecycle(target, 'EXPIRED', item.value.closedAt, 'EXPIRED', ['Target expired at the first completed candle satisfying the configured expiration rule.'], { candle: item.value, candleIndex: item.index }); lifecycleEvents.push(event); return withEvent(target, event, { status: 'EXPIRED', expiredAt: item.value.closedAt }); }
      if (target.firstTestedAt === null) {
        const touch = Math.max(configuration.touchToleranceAbsolute, Math.abs(target.price) * configuration.touchToleranceRelative);
        const tested = target.side === 'BUY_SIDE' ? item.value.high >= target.lowerBoundary - touch : item.value.low <= target.upperBoundary + touch;
        if (tested) { const event = lifecycle(target, 'TESTED', item.value.closedAt, 'TESTED', ['Target was tested when the completed candle reached its liquidity boundary.'], { candle: item.value, candleIndex: item.index }); lifecycleEvents.push(event); return withEvent(target, event, { status: 'TESTED', firstTestedAt: item.value.closedAt }); }
      }
      return target;
    });
  }
  lifecycleEvents.sort((a, b) => ts(a.detectedAt, 'INVALID_CANDLES', 'Lifecycle') - ts(b.detectedAt, 'INVALID_CANDLES', 'Lifecycle') || ({ CREATED: 0, MEMBER_ADDED: 1, BROKEN: 2, SWEPT: 3, INVALIDATED: 4, EXPIRED: 5, TESTED: 6 }[a.eventType] - { CREATED: 0, MEMBER_ADDED: 1, BROKEN: 2, SWEPT: 3, INVALIDATED: 4, EXPIRED: 5, TESTED: 6 }[b.eventType]) || a.id.localeCompare(b.id));
  return deepFreeze({ detectorVersion: STRUCTURAL_LIQUIDITY_TARGET_VERSION, targets, lifecycleEvents, rejectedCandidates, warnings, configuration });
}

export function rankAvailableLiquidityTargets(input: RankLiquidityTargetsInput): RankedLiquidityTarget[] {
  if (!Number.isFinite(input.referencePrice) || input.referencePrice <= 0 || !Number.isFinite(ts(input.referenceTimestamp, 'INVALID_CONFIGURATION', 'Reference'))) throw new StructuralLiquidityTargetError('INVALID_CONFIGURATION', 'Ranking reference must be valid.');
  const mode = input.mode ?? 'ABSOLUTE_DISTANCE';
  if (mode === 'ATR_NORMALIZED_DISTANCE' && (!Number.isFinite(input.atrValue) || input.atrValue! <= 0)) return [];
  const values = input.targets.filter((target) => !isTerminal(target.status) && (!input.side || target.side === input.side) && ts(target.detectedAt, 'INVALID_SWING', 'Target') <= ts(input.referenceTimestamp, 'INVALID_CONFIGURATION', 'Reference')).map((target) => {
    const absoluteDistance = Math.abs(target.price - input.referencePrice), relativeDistance = absoluteDistance / Math.abs(input.referencePrice), atrNormalizedDistance = input.atrValue && input.atrValue > 0 ? absoluteDistance / input.atrValue : null;
    return { target, absoluteDistance, relativeDistance, atrNormalizedDistance, metric: mode === 'RELATIVE_DISTANCE' ? relativeDistance : mode === 'ATR_NORMALIZED_DISTANCE' ? atrNormalizedDistance! : absoluteDistance };
  }).sort((a, b) => a.metric - b.metric || ts(a.target.detectedAt, 'INVALID_SWING', 'Target') - ts(b.target.detectedAt, 'INVALID_SWING', 'Target') || a.target.id.localeCompare(b.target.id));
  return deepFreeze(values.map(({ target, absoluteDistance, relativeDistance, atrNormalizedDistance }, index) => ({ rank: index + 1, targetId: target.id, side: target.side, targetType: target.targetType, status: target.status, price: target.price, absoluteDistance, relativeDistance, atrNormalizedDistance, memberCount: target.memberCount, detectedAt: target.detectedAt, confirmationAgeMs: ts(input.referenceTimestamp, 'INVALID_CONFIGURATION', 'Reference') - ts(target.confirmedAt, 'INVALID_SWING', 'Target'), sourceLabels: [...target.sourceSwingLabels] })));
}

export function createStructuralLiquidityTargetDetector(input: Partial<StructuralLiquidityTargetConfig> = {}): IncrementalStructuralLiquidityTargetDetector {
  const configuration = configFor(input), candles: NormalizedCandle[] = [], swings: ConfirmedSwing[] = [], snapshots: StructureSnapshot[] = [], bosEvents: BreakOfStructureEvent[] = [], sweepEvents: StructuralLiquiditySweepEvent[] = [];
  let result = detectStructuralLiquidityTargets({ candles, confirmedSwings: swings, structureSnapshots: snapshots, bosEvents, sweepEvents, config: configuration }), newTargets: StructuralLiquidityTarget[] = [], newEvents: LiquidityTargetLifecycleEvent[] = [];
  const lastOpen = () => candles.at(-1)?.openedAt;
  const recompute = () => { const priorTargets = new Set(result.targets.map((v) => v.id)), priorEvents = new Set(result.lifecycleEvents.map((v) => v.id)); result = detectStructuralLiquidityTargets({ candles, confirmedSwings: swings, structureSnapshots: snapshots, bosEvents, sweepEvents, config: configuration }); newTargets = result.targets.filter((v) => !priorTargets.has(v.id)); newEvents = result.lifecycleEvents.filter((v) => !priorEvents.has(v.id)); };
  const late = (time: string) => { if (lastOpen() && ts(time, 'LATE_INCREMENTAL_INFORMATION', 'Input') <= ts(lastOpen()!, 'INVALID_CANDLES', 'Candle')) throw new StructuralLiquidityTargetError('LATE_INCREMENTAL_INFORMATION', 'Structural input cannot mutate processed history.'); };
  const api: IncrementalStructuralLiquidityTargetDetector = {
    pushConfirmedSwing(value) { if (swings.some((v) => v.id === value.id)) throw new StructuralLiquidityTargetError('DUPLICATE_SWING_ID', `Duplicate swing ${value.id}.`); if (swings.at(-1) && ts(value.confirmedAt, 'INVALID_SWING', 'Swing') < ts(swings.at(-1)!.confirmedAt, 'INVALID_SWING', 'Swing')) throw new StructuralLiquidityTargetError('OUT_OF_ORDER_INCREMENTAL_INPUT', 'Swings must not move backward.'); late(value.confirmedAt); swings.push(deepFreeze(structuredClone(value))); },
    pushStructureSnapshot(value) { if (snapshots.some((v) => v.id === value.id)) throw new StructuralLiquidityTargetError('DUPLICATE_SNAPSHOT_ID', `Duplicate snapshot ${value.id}.`); if (!value.processedAt) throw new StructuralLiquidityTargetError('INVALID_SNAPSHOT', 'Snapshot requires processedAt.'); if (snapshots.at(-1) && ts(value.processedAt, 'INVALID_SNAPSHOT', 'Snapshot') < ts(snapshots.at(-1)!.processedAt!, 'INVALID_SNAPSHOT', 'Snapshot')) throw new StructuralLiquidityTargetError('OUT_OF_ORDER_INCREMENTAL_INPUT', 'Snapshots must not move backward.'); late(value.processedAt); snapshots.push(deepFreeze(structuredClone(value))); recompute(); },
    pushBosEvent(value) { if (bosEvents.some((v) => v.id === value.id)) throw new StructuralLiquidityTargetError('DUPLICATE_BOS_ID', `Duplicate BOS ${value.id}.`); if (bosEvents.at(-1) && eventTime(value) < eventTime(bosEvents.at(-1)!)) throw new StructuralLiquidityTargetError('OUT_OF_ORDER_INCREMENTAL_INPUT', 'BOS events must not move backward.'); late(value.detectedAt); bosEvents.push(deepFreeze(structuredClone(value))); recompute(); },
    pushSweepEvent(value) { if (sweepEvents.some((v) => v.id === value.id)) throw new StructuralLiquidityTargetError('DUPLICATE_SWEEP_ID', `Duplicate sweep ${value.id}.`); if (sweepEvents.at(-1) && ts(value.detectedAt, 'INVALID_SWEEP_EVENT', 'Sweep') < ts(sweepEvents.at(-1)!.detectedAt, 'INVALID_SWEEP_EVENT', 'Sweep')) throw new StructuralLiquidityTargetError('OUT_OF_ORDER_INCREMENTAL_INPUT', 'Sweep events must not move backward.'); late(value.detectedAt); sweepEvents.push(deepFreeze(structuredClone(value))); recompute(); },
    pushCandle(value) { if (lastOpen() && ts(value.openedAt, 'INVALID_CANDLES', 'Candle') <= ts(lastOpen()!, 'INVALID_CANDLES', 'Candle')) throw new StructuralLiquidityTargetError('OUT_OF_ORDER_INCREMENTAL_INPUT', 'Candles must have unique ascending openedAt.'); candles.push(deepFreeze(structuredClone(value))); recompute(); return deepFreeze([...newTargets]); },
    getNewTargets() { const out = deepFreeze([...newTargets]); newTargets = []; return out; }, getNewLifecycleEvents() { const out = deepFreeze([...newEvents]); newEvents = []; return out; },
    getAllTargets() { return deepFreeze([...result.targets]); }, getAvailableTargets() { return deepFreeze(result.targets.filter((v) => !isTerminal(v.status))); }, getTerminalTargets() { return deepFreeze(result.targets.filter((v) => isTerminal(v.status))); },
    getRejectedCandidates() { return deepFreeze([...result.rejectedCandidates]); }, getWarnings() { return deepFreeze([...result.warnings]); },
    rankAvailableTargets(rankInput) { return rankAvailableLiquidityTargets({ ...rankInput, targets: result.targets }); }, getResult() { return result; },
    reset() { candles.length = swings.length = snapshots.length = bosEvents.length = sweepEvents.length = 0; newTargets = []; newEvents = []; result = detectStructuralLiquidityTargets({ candles, confirmedSwings: swings, structureSnapshots: snapshots, bosEvents, sweepEvents, config: configuration }); },
  }; return Object.freeze(api);
}
export function serializeStructuralLiquidityTargetResult(result: StructuralLiquidityTargetResult): string { return canonicalStringify(result); }
