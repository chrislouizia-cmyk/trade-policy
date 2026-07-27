import { simpleAtr, validateCandles } from '../../analysis-utils/index.ts';
import type { NormalizedCandle } from '../../contracts.ts';
import { canonicalStringify, stableFingerprint } from '../../serialization/stable-fingerprint.ts';
import type { FairValueGap, FairValueGapCandidate, FairValueGapConfig, FairValueGapDetectionInput, FairValueGapDetectionResult, FairValueGapDirection, FairValueGapLifecycleEvent, FairValueGapLifecycleEventType, FairValueGapStatus, IncrementalFairValueGapLifecycleDetector } from './fair-value-gap-lifecycle-types.ts';

export const FAIR_VALUE_GAP_LIFECYCLE_VERSION = '1.0.0';
export const DEFAULT_FAIR_VALUE_GAP_CONFIG: FairValueGapConfig = Object.freeze({
  absoluteTolerance: 0, relativeTolerance: 0, minimumGapAbsolute: 0, minimumGapRelative: 0, minimumGapAtrMultiple: 0, atrPeriod: 14,
  gapDefinition: 'WICK_TO_WICK', mitigationPolicy: 'PERCENT_FILLED', partialMitigationThresholdPercent: .01, fullMitigationThresholdPercent: 1,
  invalidationPolicy: 'CLOSE_THROUGH_FAR_BOUNDARY', expirationPolicy: 'NEVER', expirationCandles: 0, expirationMilliseconds: 0,
  overlappingGapPolicy: 'KEEP_SEPARATE', sameCandleLifecyclePolicy: 'CREATION_ONLY', firstTouchTracking: true,
});

export class FairValueGapLifecycleError extends Error {
  readonly code: 'INVALID_CONFIGURATION' | 'INVALID_CANDLES' | 'DUPLICATE_CANDLE' | 'OUT_OF_ORDER_INCREMENTAL_INPUT';
  constructor(code: FairValueGapLifecycleError['code'], message: string) { super(message); this.name = 'FairValueGapLifecycleError'; this.code = code; }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); }
  return value;
}

function configFor(input: Partial<FairValueGapConfig> = {}): FairValueGapConfig {
  const config: FairValueGapConfig = {
    absoluteTolerance: input.absoluteTolerance ?? 0, relativeTolerance: input.relativeTolerance ?? 0,
    minimumGapAbsolute: input.minimumGapAbsolute ?? 0, minimumGapRelative: input.minimumGapRelative ?? 0,
    minimumGapAtrMultiple: input.minimumGapAtrMultiple ?? 0, atrPeriod: input.atrPeriod ?? 14,
    gapDefinition: input.gapDefinition ?? 'WICK_TO_WICK', mitigationPolicy: input.mitigationPolicy ?? 'PERCENT_FILLED',
    partialMitigationThresholdPercent: input.partialMitigationThresholdPercent ?? .01, fullMitigationThresholdPercent: input.fullMitigationThresholdPercent ?? 1,
    invalidationPolicy: input.invalidationPolicy ?? 'CLOSE_THROUGH_FAR_BOUNDARY', expirationPolicy: input.expirationPolicy ?? 'NEVER',
    expirationCandles: input.expirationCandles ?? 0, expirationMilliseconds: input.expirationMilliseconds ?? 0,
    overlappingGapPolicy: input.overlappingGapPolicy ?? 'KEEP_SEPARATE', sameCandleLifecyclePolicy: input.sameCandleLifecyclePolicy ?? 'CREATION_ONLY',
    firstTouchTracking: input.firstTouchTracking ?? true,
  };
  for (const [key, value] of Object.entries({
    absoluteTolerance: config.absoluteTolerance, relativeTolerance: config.relativeTolerance, minimumGapAbsolute: config.minimumGapAbsolute,
    minimumGapRelative: config.minimumGapRelative, minimumGapAtrMultiple: config.minimumGapAtrMultiple, expirationMilliseconds: config.expirationMilliseconds,
  })) if (!Number.isFinite(value) || value < 0) throw new FairValueGapLifecycleError('INVALID_CONFIGURATION', `${key} must be non-negative and finite.`);
  if (!Number.isInteger(config.atrPeriod) || config.atrPeriod < 1 || !Number.isInteger(config.expirationCandles) || config.expirationCandles < 0) throw new FairValueGapLifecycleError('INVALID_CONFIGURATION', 'ATR period and expiration candle count must be valid integers.');
  if (config.partialMitigationThresholdPercent < 0 || config.partialMitigationThresholdPercent > 1 || config.fullMitigationThresholdPercent <= 0 || config.fullMitigationThresholdPercent > 1 || config.partialMitigationThresholdPercent > config.fullMitigationThresholdPercent) throw new FairValueGapLifecycleError('INVALID_CONFIGURATION', 'Mitigation thresholds must be ordered within zero and one.');
  if (config.expirationPolicy === 'AFTER_N_CANDLES' && config.expirationCandles < 1) throw new FairValueGapLifecycleError('INVALID_CONFIGURATION', 'AFTER_N_CANDLES requires expirationCandles.');
  if (config.expirationPolicy === 'AFTER_N_MILLISECONDS' && config.expirationMilliseconds <= 0) throw new FairValueGapLifecycleError('INVALID_CONFIGURATION', 'AFTER_N_MILLISECONDS requires expirationMilliseconds.');
  if (!['WICK_TO_WICK'].includes(config.gapDefinition) || !['TOUCH', 'PERCENT_FILLED', 'FULL_FILL'].includes(config.mitigationPolicy)
    || !['CLOSE_THROUGH_FAR_BOUNDARY', 'WICK_THROUGH_FAR_BOUNDARY', 'NONE'].includes(config.invalidationPolicy)
    || !['NEVER', 'AFTER_N_CANDLES', 'AFTER_N_MILLISECONDS'].includes(config.expirationPolicy)
    || !['KEEP_SEPARATE', 'MERGE_SAME_DIRECTION', 'REJECT_NESTED'].includes(config.overlappingGapPolicy)
    || !['CREATION_ONLY', 'ALLOW_CREATION_AND_TOUCH'].includes(config.sameCandleLifecyclePolicy)) throw new FairValueGapLifecycleError('INVALID_CONFIGURATION', 'Unknown FVG lifecycle policy.');
  return deepFreeze(config);
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new FairValueGapLifecycleError('INVALID_CANDLES', 'Candle timestamps must be valid.');
  return parsed;
}

function candlesFor(values: readonly NormalizedCandle[], warnings: string[]): NormalizedCandle[] {
  const ordered = [...values].sort((a, b) => timestamp(a.openedAt) - timestamp(b.openedAt));
  const seen = new Set<string>();
  for (const candle of ordered) {
    if (seen.has(candle.openedAt)) throw new FairValueGapLifecycleError('DUPLICATE_CANDLE', `Duplicate candle openedAt: ${candle.openedAt}.`);
    seen.add(candle.openedAt);
    if ([candle.open, candle.high, candle.low, candle.close].some((value) => !Number.isFinite(value) || value <= 0)) throw new FairValueGapLifecycleError('INVALID_CANDLES', 'OHLC prices must be positive and finite.');
    if (timestamp(candle.closedAt) <= timestamp(candle.openedAt)) throw new FairValueGapLifecycleError('INVALID_CANDLES', 'Candle closedAt must follow openedAt.');
  }
  const complete = ordered.filter((candle) => { if (candle.complete) return true; warnings.push(`Ignored incomplete candle at ${candle.openedAt}.`); return false; });
  const validation = validateCandles(complete);
  if (!validation.valid) throw new FairValueGapLifecycleError('INVALID_CANDLES', validation.issues.map((issue) => issue.message).join(' '));
  return complete;
}

const candleId = (candle: NormalizedCandle): string => `candle:${stableFingerprint(candle)}`;
const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const terminal = (status: FairValueGapStatus): boolean => ['FULLY_MITIGATED', 'INVALIDATED', 'EXPIRED'].includes(status);

function lifecycleEvent(gap: FairValueGap, type: FairValueGapLifecycleEventType, candle: NormalizedCandle, candleIndex: number, priorStatus: FairValueGapStatus | null, newStatus: FairValueGapStatus, before: number, after: number, evidence: string[], config: FairValueGapConfig): FairValueGapLifecycleEvent {
  const identity = { version: FAIR_VALUE_GAP_LIFECYCLE_VERSION, fvgId: gap.id, type, candle: { candleIndex, ...candle }, priorStatus, newStatus, before, after, config };
  const fingerprint = stableFingerprint(identity);
  return deepFreeze({ id: `fvg-lifecycle:${fingerprint}`, version: FAIR_VALUE_GAP_LIFECYCLE_VERSION, fvgId: gap.id, eventType: type, direction: gap.direction, candleIndex, detectedAt: candle.closedAt, priorStatus, newStatus, fillPercentBefore: before, fillPercentAfter: after, candleOpen: candle.open, candleHigh: candle.high, candleLow: candle.low, candleClose: candle.close, evidence, fingerprint });
}

function candidate(direction: FairValueGapDirection, c1: NormalizedCandle, c2: NormalizedCandle, c3: NormalizedCandle, i: number, lower: number, upper: number, size: number, reason: string): FairValueGapCandidate {
  const identity = { version: FAIR_VALUE_GAP_LIFECYCLE_VERSION, direction, c1: candleId(c1), c2: candleId(c2), c3: candleId(c3), lower, upper, size, reason };
  const fingerprint = stableFingerprint(identity);
  return deepFreeze({ id: `fvg-candidate:${fingerprint}`, direction, candle1Index: i - 2, candle2Index: i - 1, candle3Index: i, lowerBound: lower, upperBound: upper, gapSize: size, detectedAt: c3.closedAt, rejectionReason: reason, fingerprint });
}

function createGap(direction: FairValueGapDirection, c1: NormalizedCandle, c2: NormalizedCandle, c3: NormalizedCandle, i: number, lower: number, upper: number, sizeRelative: number, atrMultiple: number | null, config: FairValueGapConfig, sourceGapIds: string[] = []): FairValueGap {
  const identity = { version: FAIR_VALUE_GAP_LIFECYCLE_VERSION, direction, c1: candleId(c1), c2: candleId(c2), c3: candleId(c3), lower, upper, sourceGapIds, config };
  const fingerprint = stableFingerprint(identity), id = `fair-value-gap-lifecycle:${fingerprint}`;
  const evidence = [
    `${direction === 'BULLISH' ? 'Bullish' : 'Bearish'} FVG created because candle 3 ${direction === 'BULLISH' ? `low ${c3.low} exceeded candle 1 high ${c1.high}` : `high ${c3.high} fell below candle 1 low ${c1.low}`}.`,
    `Gap boundaries: ${lower} to ${upper}.`,
    `FVG became visible only when candle 3 closed at ${c3.closedAt}.`,
  ];
  return deepFreeze({
    id, version: FAIR_VALUE_GAP_LIFECYCLE_VERSION, direction, status: 'ACTIVE', lowerBound: lower, upperBound: upper, midpoint: (lower + upper) / 2,
    gapSize: upper - lower, gapSizeRelative: sizeRelative, gapSizeAtrMultiple: atrMultiple, candle1Index: i - 2, candle2Index: i - 1, candle3Index: i,
    candle1Id: candleId(c1), candle2Id: candleId(c2), candle3Id: candleId(c3), createdAt: c3.closedAt, detectedAt: c3.closedAt,
    firstTouchedAt: null, partiallyMitigatedAt: null, fullyMitigatedAt: null, invalidatedAt: null, expiredAt: null,
    maximumFillPercent: 0, remainingLowerBound: lower, remainingUpperBound: upper, middleCandleBody: Math.abs(c2.close - c2.open), middleCandleRange: c2.high - c2.low,
    sourceGapIds: [...sourceGapIds], lifecycleEventIds: [], evidence, fingerprint,
  });
}

function updatedGap(gap: FairValueGap, updates: Partial<FairValueGap>, eventIds: readonly string[]): FairValueGap {
  return deepFreeze({ ...gap, ...updates, lifecycleEventIds: [...gap.lifecycleEventIds, ...eventIds] });
}

function fillFor(gap: FairValueGap, candle: NormalizedCandle): number {
  const penetration = gap.direction === 'BULLISH' ? gap.upperBound - Math.min(candle.low, gap.upperBound) : Math.max(candle.high, gap.lowerBound) - gap.lowerBound;
  return clamp(penetration / gap.gapSize);
}

function touched(gap: FairValueGap, candle: NormalizedCandle): boolean {
  return candle.low <= gap.upperBound && candle.high >= gap.lowerBound;
}

function invalidated(gap: FairValueGap, candle: NormalizedCandle, config: FairValueGapConfig): boolean {
  if (config.invalidationPolicy === 'NONE') return false;
  const reference = gap.direction === 'BULLISH' ? gap.lowerBound : gap.upperBound;
  const tolerance = Math.max(config.absoluteTolerance, Math.abs(reference) * config.relativeTolerance);
  if (config.invalidationPolicy === 'CLOSE_THROUGH_FAR_BOUNDARY') return gap.direction === 'BULLISH' ? candle.close < gap.lowerBound - tolerance : candle.close > gap.upperBound + tolerance;
  return gap.direction === 'BULLISH' ? candle.low < gap.lowerBound - tolerance : candle.high > gap.upperBound + tolerance;
}

function expiration(gap: FairValueGap, candle: NormalizedCandle, candleIndex: number, config: FairValueGapConfig): boolean {
  if (config.expirationPolicy === 'NEVER') return false;
  if (config.expirationPolicy === 'AFTER_N_CANDLES') return candleIndex - gap.candle3Index >= config.expirationCandles;
  return timestamp(candle.closedAt) - timestamp(gap.detectedAt) >= config.expirationMilliseconds;
}

function processGap(gap: FairValueGap, candle: NormalizedCandle, index: number, config: FairValueGapConfig): { gap: FairValueGap; events: FairValueGapLifecycleEvent[] } {
  if (terminal(gap.status) || index <= gap.candle3Index) return { gap, events: [] };
  const before = gap.maximumFillPercent, fill = Math.max(before, fillFor(gap, candle)), isTouch = touched(gap, candle);
  const events: FairValueGapLifecycleEvent[] = [];
  if (invalidated(gap, candle, config)) {
    const event = lifecycleEvent(gap, 'INVALIDATION', candle, index, gap.status, 'INVALIDATED', before, fill, ['FVG invalidated by the configured far-boundary rule.'], config);
    return { gap: updatedGap(gap, { status: 'INVALIDATED', invalidatedAt: candle.closedAt, maximumFillPercent: fill, remainingLowerBound: null, remainingUpperBound: null }, [event.id]), events: [event] };
  }
  const fullThreshold = config.mitigationPolicy === 'FULL_FILL' ? 1 : config.fullMitigationThresholdPercent;
  const full = config.mitigationPolicy === 'TOUCH' ? isTouch : isTouch && fill >= fullThreshold;
  const partial = isTouch && fill >= config.partialMitigationThresholdPercent && fill < fullThreshold;
  let status = gap.status;
  if (full) status = 'FULLY_MITIGATED';
  else if (partial) status = 'PARTIALLY_MITIGATED';
  else if (expiration(gap, candle, index, config)) status = 'EXPIRED';
  if (full) events.push(lifecycleEvent(gap, 'FULL_MITIGATION', candle, index, gap.status, status, before, fill, [`FVG reached ${fill * 100}% maximum fill and was fully mitigated.`], config));
  else if (partial && gap.status !== 'PARTIALLY_MITIGATED') events.push(lifecycleEvent(gap, 'PARTIAL_MITIGATION', candle, index, gap.status, status, before, fill, [`FVG reached ${fill * 100}% maximum fill.`], config));
  else if (status === 'EXPIRED') events.push(lifecycleEvent(gap, 'EXPIRATION', candle, index, gap.status, status, before, fill, ['FVG expired at the first candle close satisfying the configured expiration rule.'], config));
  if (config.firstTouchTracking && isTouch && gap.firstTouchedAt === null) events.push(lifecycleEvent(gap, 'FIRST_TOUCH', candle, index, gap.status, status, before, fill, ['First touch detected when the completed candle entered the active gap.'], config));
  const penetration = fill * gap.gapSize;
  const remainingLower = terminal(status) ? null : gap.direction === 'BULLISH' ? gap.lowerBound : gap.lowerBound + penetration;
  const remainingUpper = terminal(status) ? null : gap.direction === 'BULLISH' ? gap.upperBound - penetration : gap.upperBound;
  return {
    gap: updatedGap(gap, {
      status, maximumFillPercent: fill, firstTouchedAt: gap.firstTouchedAt ?? (isTouch && config.firstTouchTracking ? candle.closedAt : null),
      partiallyMitigatedAt: gap.partiallyMitigatedAt ?? (partial ? candle.closedAt : null), fullyMitigatedAt: gap.fullyMitigatedAt ?? (full ? candle.closedAt : null),
      expiredAt: gap.expiredAt ?? (status === 'EXPIRED' ? candle.closedAt : null), remainingLowerBound: remainingLower, remainingUpperBound: remainingUpper,
    }, events.map((event) => event.id)),
    events,
  };
}

function overlaps(left: FairValueGap, lower: number, upper: number): boolean { return lower <= left.upperBound && upper >= left.lowerBound; }

export function detectFairValueGapLifecycles(input: FairValueGapDetectionInput): FairValueGapDetectionResult {
  const configuration = configFor(input.config), warnings: string[] = [], candles = candlesFor(input.candles, warnings);
  if (candles.length > 0 && candles.length < 3) warnings.push(`Fair Value Gap creation requires three completed candles; ${candles.length} available.`);
  let gaps: FairValueGap[] = [];
  const lifecycleEvents: FairValueGapLifecycleEvent[] = [], rejectedCandidates: FairValueGapCandidate[] = [];
  for (let index = 0; index < candles.length; index++) {
    const candle = candles[index]!;
    const processed = gaps.map((gap) => processGap(gap, candle, index, configuration));
    gaps = processed.map((value) => value.gap);
    lifecycleEvents.push(...processed.flatMap((value) => value.events));
    if (index < 2) continue;
    const c1 = candles[index - 2]!, c2 = candles[index - 1]!, c3 = candle;
    const bullishTolerance = Math.max(configuration.absoluteTolerance, Math.abs(c1.high) * configuration.relativeTolerance);
    const bearishTolerance = Math.max(configuration.absoluteTolerance, Math.abs(c1.low) * configuration.relativeTolerance);
    const direction: FairValueGapDirection | null = c3.low > c1.high + bullishTolerance ? 'BULLISH' : c3.high < c1.low - bearishTolerance ? 'BEARISH' : null;
    if (!direction) continue;
    let lower = direction === 'BULLISH' ? c1.high : c3.high, upper = direction === 'BULLISH' ? c3.low : c1.low;
    const size = upper - lower, reference = direction === 'BULLISH' ? c1.high : c1.low, relative = size / Math.abs(reference);
    let atrMultiple: number | null = null, reason: string | null = null;
    if (configuration.minimumGapAtrMultiple > 0) {
      const atr = simpleAtr(candles.slice(0, index + 1), configuration.atrPeriod);
      if (!atr.sufficientData || atr.value === null) reason = 'INSUFFICIENT_ATR_HISTORY';
      else { atrMultiple = size / atr.value; if (atrMultiple < configuration.minimumGapAtrMultiple) reason = 'ATR_GAP_BELOW_MINIMUM'; }
    }
    if (!reason && size < configuration.minimumGapAbsolute) reason = 'ABSOLUTE_GAP_BELOW_MINIMUM';
    if (!reason && relative < configuration.minimumGapRelative) reason = 'RELATIVE_GAP_BELOW_MINIMUM';
    const activeSameDirection = gaps.filter((gap) => gap.direction === direction && !terminal(gap.status));
    if (!reason && configuration.overlappingGapPolicy === 'REJECT_NESTED' && activeSameDirection.some((gap) => lower >= gap.lowerBound && upper <= gap.upperBound)) reason = 'NESTED_GAP_REJECTED';
    if (reason) { rejectedCandidates.push(candidate(direction, c1, c2, c3, index, lower, upper, size, reason)); continue; }
    let sourceGapIds: string[] = [];
    if (configuration.overlappingGapPolicy === 'MERGE_SAME_DIRECTION') {
      const merging = activeSameDirection.filter((gap) => overlaps(gap, lower, upper));
      if (merging.length) {
        lower = Math.min(lower, ...merging.map((gap) => gap.lowerBound)); upper = Math.max(upper, ...merging.map((gap) => gap.upperBound));
        sourceGapIds = merging.flatMap((gap) => [gap.id, ...gap.sourceGapIds]).sort();
        const mergingIds = new Set(merging.map((gap) => gap.id)); gaps = gaps.filter((gap) => !mergingIds.has(gap.id));
      }
    }
    let gap = createGap(direction, c1, c2, c3, index, lower, upper, (upper - lower) / Math.abs(reference), atrMultiple, configuration, sourceGapIds);
    const created = lifecycleEvent(gap, 'CREATED', c3, index, null, 'ACTIVE', 0, 0, gap.evidence, configuration);
    gap = updatedGap(gap, {}, [created.id]); lifecycleEvents.push(created);
    if (configuration.sameCandleLifecyclePolicy === 'ALLOW_CREATION_AND_TOUCH' && configuration.firstTouchTracking) {
      const touch = lifecycleEvent(gap, 'FIRST_TOUCH', c3, index, 'ACTIVE', 'ACTIVE', 0, 0, ['Creation candle counted as first touch by explicit policy.'], configuration);
      gap = updatedGap(gap, { firstTouchedAt: c3.closedAt }, [touch.id]); lifecycleEvents.push(touch);
    }
    gaps.push(gap);
  }
  return deepFreeze({ detectorVersion: FAIR_VALUE_GAP_LIFECYCLE_VERSION, gaps, lifecycleEvents, rejectedCandidates, warnings, configuration });
}

export function createFairValueGapLifecycleDetector(input: Partial<FairValueGapConfig> = {}): IncrementalFairValueGapLifecycleDetector {
  const configuration = configFor(input), candles: NormalizedCandle[] = [];
  let result = detectFairValueGapLifecycles({ candles, config: configuration }), newGaps: FairValueGap[] = [], newEvents: FairValueGapLifecycleEvent[] = [];
  const api: IncrementalFairValueGapLifecycleDetector = {
    pushCandle(candle) {
      if (candles.some((value) => value.openedAt === candle.openedAt)) throw new FairValueGapLifecycleError('DUPLICATE_CANDLE', `Duplicate candle openedAt: ${candle.openedAt}.`);
      if (candles.at(-1) && timestamp(candle.openedAt) <= timestamp(candles.at(-1)!.openedAt)) throw new FairValueGapLifecycleError('OUT_OF_ORDER_INCREMENTAL_INPUT', 'Incremental candles must have unique ascending openedAt.');
      const oldGapIds = new Set(result.gaps.map((gap) => gap.id)), oldEventIds = new Set(result.lifecycleEvents.map((event) => event.id));
      candles.push(deepFreeze(structuredClone(candle))); result = detectFairValueGapLifecycles({ candles, config: configuration });
      newGaps = result.gaps.filter((gap) => !oldGapIds.has(gap.id)); newEvents = result.lifecycleEvents.filter((event) => !oldEventIds.has(event.id));
      return deepFreeze([...newGaps]);
    },
    getNewGaps() { const value = deepFreeze([...newGaps]); newGaps = []; return value; },
    getNewLifecycleEvents() { const value = deepFreeze([...newEvents]); newEvents = []; return value; },
    getAllGaps() { return deepFreeze([...result.gaps]); },
    getActiveGaps() { return deepFreeze(result.gaps.filter((gap) => !terminal(gap.status))); },
    getTerminalGaps() { return deepFreeze(result.gaps.filter((gap) => terminal(gap.status))); },
    getRejectedCandidates() { return deepFreeze([...result.rejectedCandidates]); },
    getWarnings() { return deepFreeze([...result.warnings]); },
    getResult() { return result; },
    reset() { candles.length = 0; newGaps = []; newEvents = []; result = detectFairValueGapLifecycles({ candles, config: configuration }); },
  };
  return Object.freeze(api);
}

export function serializeFairValueGapDetectionResult(result: FairValueGapDetectionResult): string { return canonicalStringify(result); }
