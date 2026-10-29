import { simpleAtr, validateCandles } from '../../analysis-utils/index.ts';
import type { NormalizedCandle } from '../../contracts.ts';
import type { ConfirmedSwing } from '../../detectors/confirmed-swing/confirmed-swing-types.ts';
import type { FairValueGap, FairValueGapStatus } from '../../imbalance/fair-value-gap/fair-value-gap-lifecycle-types.ts';
import { canonicalStringify, stableFingerprint } from '../../serialization/stable-fingerprint.ts';
import type { ClassifiedSwing, StructureSnapshot } from '../../structure/structure-types.ts';
import type { StructuralStopCandidate, StructuralStopCandidateConfig, StructuralStopCandidateGenerator, StructuralStopCandidateInput, StructuralStopCandidateRequest, StructuralStopCandidateResult, StructuralStopCandidateType, StopCandidateRejectionReason } from './structural-stop-candidate-types.ts';

export const STRUCTURAL_STOP_CANDIDATE_VERSION = '1.0.0';
const PRIORITY: Record<StructuralStopCandidateType, number> = { COMBINED_STRUCTURAL_ORIGIN_FVG: 1, PROTECTED_SWING: 2, STRUCTURAL_INVALIDATION_LEVEL: 3, SWEEP_EXTREME: 4, FVG_FAR_BOUNDARY: 5, LATEST_CONFIRMED_SWING: 6 };
export const DEFAULT_STRUCTURAL_STOP_CANDIDATE_CONFIG: StructuralStopCandidateConfig = Object.freeze({
  enabledCandidateTypes: Object.freeze(['PROTECTED_SWING', 'LATEST_CONFIRMED_SWING', 'SWEEP_EXTREME', 'FVG_FAR_BOUNDARY']),
  protectedSwingPolicy: 'ACTIVE_PROTECTED_SWING', latestSwingPolicy: 'LATEST_ACCEPTED_STRUCTURE',
  eligibleFvgStatuses: Object.freeze(['ACTIVE', 'PARTIALLY_MITIGATED']), fvgSelectionPolicy: 'EXPLICIT_SOURCE_ONLY', sweepSelectionPolicy: 'EXPLICIT_SOURCE_ONLY',
  bufferPolicy: 'NONE', absoluteBuffer: 0, relativeBuffer: 0, atrBufferMultiple: 0, atrPeriod: 14,
  candidateValidityPolicy: 'MUST_BE_BEYOND_REFERENCE_PRICE', deduplicationPolicy: 'KEEP_ALL', deduplicationTolerance: 0,
  rankingMode: 'STRUCTURAL_PRIORITY', maximumCandidateCount: null,
}) as StructuralStopCandidateConfig;

export class StructuralStopCandidateError extends Error {
  readonly code: 'INVALID_CONFIGURATION' | 'INVALID_REQUEST' | 'INVALID_INPUT' | 'DUPLICATE_INPUT' | 'OUT_OF_ORDER_INCREMENTAL_INPUT';
  constructor(code: StructuralStopCandidateError['code'], message: string) { super(message); this.name = 'StructuralStopCandidateError'; this.code = code; }
}
const time = (value: string, code: StructuralStopCandidateError['code'] = 'INVALID_INPUT'): number => { const parsed = Date.parse(value); if (!Number.isFinite(parsed)) throw new StructuralStopCandidateError(code, `Invalid timestamp: ${value}.`); return parsed; };
function freeze<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function configFor(input: Partial<StructuralStopCandidateConfig> = {}): StructuralStopCandidateConfig {
  const c: StructuralStopCandidateConfig = { ...DEFAULT_STRUCTURAL_STOP_CANDIDATE_CONFIG, ...input, enabledCandidateTypes: [...(input.enabledCandidateTypes ?? DEFAULT_STRUCTURAL_STOP_CANDIDATE_CONFIG.enabledCandidateTypes)], eligibleFvgStatuses: [...(input.eligibleFvgStatuses ?? DEFAULT_STRUCTURAL_STOP_CANDIDATE_CONFIG.eligibleFvgStatuses)] };
  for (const [key, value] of Object.entries({ absoluteBuffer: c.absoluteBuffer, relativeBuffer: c.relativeBuffer, atrBufferMultiple: c.atrBufferMultiple, deduplicationTolerance: c.deduplicationTolerance })) if (!Number.isFinite(value) || value < 0) throw new StructuralStopCandidateError('INVALID_CONFIGURATION', `${key} must be non-negative and finite.`);
  if (!Number.isInteger(c.atrPeriod) || c.atrPeriod < 1 || (c.maximumCandidateCount !== null && (!Number.isInteger(c.maximumCandidateCount) || c.maximumCandidateCount < 1))) throw new StructuralStopCandidateError('INVALID_CONFIGURATION', 'ATR period and maximum count must be positive integers.');
  if (new Set(c.enabledCandidateTypes).size !== c.enabledCandidateTypes.length) throw new StructuralStopCandidateError('INVALID_CONFIGURATION', 'Candidate types must be unique.');
  return freeze(c);
}
function validateRequest(request: StructuralStopCandidateRequest): number {
  if (!['FOR_LONG', 'FOR_SHORT'].includes(request.direction) || !Number.isFinite(request.referencePrice) || request.referencePrice <= 0) throw new StructuralStopCandidateError('INVALID_REQUEST', 'Direction and positive reference price are required.');
  return time(request.referenceTimestamp, 'INVALID_REQUEST');
}
function unique<T>(values: readonly T[], id: (v: T) => string, at: (v: T) => string): T[] {
  const seen = new Set<string>(); for (const value of values) { const key = id(value); if (!key || seen.has(key)) throw new StructuralStopCandidateError('DUPLICATE_INPUT', `Duplicate or missing ID: ${key}.`); seen.add(key); time(at(value)); }
  return [...values].sort((a, b) => time(at(a)) - time(at(b)) || id(a).localeCompare(id(b)));
}
function completedCandles(values: readonly NormalizedCandle[], reference: number): NormalizedCandle[] {
  const selected = values.filter((c) => c.complete && time(c.closedAt) <= reference).sort((a, b) => time(a.openedAt) - time(b.openedAt));
  if (new Set(selected.map((c) => c.openedAt)).size !== selected.length || !validateCandles(selected).valid) throw new StructuralStopCandidateError('INVALID_INPUT', 'Candles are invalid or duplicated.');
  return selected;
}
function classified(snapshot: StructureSnapshot): ClassifiedSwing[] { return [snapshot.previousConfirmedHigh, snapshot.lastConfirmedHigh, snapshot.previousConfirmedLow, snapshot.lastConfirmedLow].filter((v): v is ClassifiedSwing => Boolean(v?.accepted)); }
function fvgStatusAt(gap: FairValueGap, reference: number): FairValueGapStatus | null {
  if (time(gap.detectedAt) > reference) return null;
  const changes: [string | null, FairValueGapStatus][] = [[gap.partiallyMitigatedAt, 'PARTIALLY_MITIGATED'], [gap.fullyMitigatedAt, 'FULLY_MITIGATED'], [gap.invalidatedAt, 'INVALIDATED'], [gap.expiredAt, 'EXPIRED']];
  return changes.filter((v): v is [string, FairValueGapStatus] => Boolean(v[0]) && time(v[0]!) <= reference).sort((a, b) => time(a[0]) - time(b[0])).at(-1)?.[1] ?? 'ACTIVE';
}
type Source = { type: StructuralStopCandidateType; raw: number; detectedAt: string; description: string; rejectionReason?: StopCandidateRejectionReason; classifiedSwing?: ClassifiedSwing; confirmedSwing?: ConfirmedSwing; snapshot?: StructureSnapshot; sweepId?: string; fvgId?: string; bosId?: string; transitionId?: string };
function bufferFor(raw: number, c: StructuralStopCandidateConfig, atr: number | null): number | null {
  const absolute = c.absoluteBuffer, relative = Math.abs(raw) * c.relativeBuffer, atrBuffer = atr === null ? null : atr * c.atrBufferMultiple;
  if (c.bufferPolicy === 'NONE') return 0; if (c.bufferPolicy === 'ABSOLUTE') return absolute; if (c.bufferPolicy === 'RELATIVE') return relative;
  if (c.bufferPolicy === 'ATR') return atrBuffer; return atrBuffer === null && c.atrBufferMultiple > 0 ? null : Math.max(absolute, relative, atrBuffer ?? 0);
}
function makeCandidate(source: Source, request: StructuralStopCandidateRequest, c: StructuralStopCandidateConfig, atr: number | null): StructuralStopCandidate {
  const applied = bufferFor(source.raw, c, atr), effective = applied === null ? source.raw : request.direction === 'FOR_LONG' ? source.raw - applied : source.raw + applied;
  let rejection: StopCandidateRejectionReason | null = source.rejectionReason ?? (applied === null ? 'ATR_UNAVAILABLE' : null);
  if (!rejection && c.candidateValidityPolicy === 'MUST_BE_BEYOND_REFERENCE_PRICE') {
    if (request.direction === 'FOR_LONG' && effective >= request.referencePrice) rejection = 'STOP_NOT_BELOW_REFERENCE_FOR_LONG';
    if (request.direction === 'FOR_SHORT' && effective <= request.referencePrice) rejection = 'STOP_NOT_ABOVE_REFERENCE_FOR_SHORT';
  }
  const sourceSwingId = source.classifiedSwing?.swing.id ?? source.confirmedSwing?.id ?? null, label = source.classifiedSwing?.label ?? null;
  const identity = { version: STRUCTURAL_STOP_CANDIDATE_VERSION, direction: request.direction, type: source.type, referencePrice: request.referencePrice, referenceTimestamp: request.referenceTimestamp, sourceSwingId, snapshotId: source.snapshot?.id ?? null, sweepId: source.sweepId ?? null, fvgId: source.fvgId ?? null, raw: source.raw, effective, applied, bufferPolicy: c.bufferPolicy, rankingMode: c.rankingMode };
  const fingerprint = stableFingerprint(identity), distance = Math.abs(request.referencePrice - effective);
  return freeze({ id: `structural-stop-candidate:${fingerprint}`, version: STRUCTURAL_STOP_CANDIDATE_VERSION, direction: request.direction, candidateType: source.type, sourceCandidateTypes: [source.type],
    rawInvalidationPrice: source.raw, effectiveStopPrice: effective, appliedBuffer: applied ?? 0, referencePrice: request.referencePrice, referenceTimestamp: request.referenceTimestamp,
    absoluteDistance: distance, relativeDistance: distance / request.referencePrice, atrNormalizedDistance: atr && atr > 0 ? distance / atr : null,
    sourceSwingIds: sourceSwingId ? [sourceSwingId] : [], sourceSwingLabels: label ? [label] : [], sourceSnapshotIds: source.snapshot ? [source.snapshot.id] : [],
    sourceSweepEventIds: source.sweepId ? [source.sweepId] : [], sourceFvgIds: source.fvgId ? [source.fvgId] : [], sourceBosEventIds: source.bosId ? [source.bosId] : [], sourceTransitionEventIds: source.transitionId ? [source.transitionId] : [],
    sourceDetectedAt: source.detectedAt, sourceDescription: source.description, structuralPriority: PRIORITY[source.type], rank: null, valid: rejection === null, rejectionReason: rejection,
    evidence: [source.description, `A buffer of ${applied ?? 0} was applied ${request.direction === 'FOR_LONG' ? 'below' : 'above'} the raw structural level.`, 'This is a structural stop candidate, not a final stop-loss recommendation.'], fingerprint });
}
function mergeCandidates(values: StructuralStopCandidate[], tolerance: number): StructuralStopCandidate[] {
  const groups: StructuralStopCandidate[][] = [];
  for (const candidate of values) { const group = groups.find((g) => Math.abs(g[0]!.effectiveStopPrice - candidate.effectiveStopPrice) <= tolerance); (group ?? (groups.push([]), groups.at(-1)!)).push(candidate); }
  return groups.map((group) => { if (group.length === 1) return group[0]!; const ordered = [...group].sort((a, b) => a.structuralPriority - b.structuralPriority || a.id.localeCompare(b.id)); const first = ordered[0]!, identity = { merged: ordered.map((v) => v.id), tolerance }, fingerprint = stableFingerprint(identity);
    return freeze({ ...first, id: `structural-stop-candidate:merged:${fingerprint}`, fingerprint, sourceCandidateTypes: [...new Set(ordered.flatMap((v) => v.sourceCandidateTypes))], sourceSwingIds: [...new Set(ordered.flatMap((v) => v.sourceSwingIds))].sort(), sourceSwingLabels: [...new Set(ordered.flatMap((v) => v.sourceSwingLabels))], sourceSnapshotIds: [...new Set(ordered.flatMap((v) => v.sourceSnapshotIds))].sort(), sourceSweepEventIds: [...new Set(ordered.flatMap((v) => v.sourceSweepEventIds))].sort(), sourceFvgIds: [...new Set(ordered.flatMap((v) => v.sourceFvgIds))].sort(), evidence: [...new Set(ordered.flatMap((v) => v.evidence))] }); });
}
function ranked(values: StructuralStopCandidate[], c: StructuralStopCandidateConfig): StructuralStopCandidate[] {
  const sorted = [...values].sort((a, b) => c.rankingMode === 'DISTANCE' ? a.absoluteDistance - b.absoluteDistance || a.id.localeCompare(b.id) : a.structuralPriority - b.structuralPriority || (c.rankingMode === 'HYBRID' ? (a.atrNormalizedDistance ?? a.relativeDistance) - (b.atrNormalizedDistance ?? b.relativeDistance) : time(b.sourceDetectedAt) - time(a.sourceDetectedAt)) || a.absoluteDistance - b.absoluteDistance || a.id.localeCompare(b.id));
  return sorted.slice(0, c.maximumCandidateCount ?? undefined).map((v, index) => freeze({ ...v, rank: index + 1 }));
}

export function generateStructuralStopCandidates(input: StructuralStopCandidateInput): StructuralStopCandidateResult {
  const c = configFor(input.config), reference = validateRequest(input.request), warnings: string[] = [], direction = input.request.direction;
  const swings = unique(input.confirmedSwings, (v) => v.id, (v) => v.confirmedAt), snapshots = unique(input.structureSnapshots.filter((v) => v.processedAt), (v) => v.id, (v) => v.processedAt!);
  const sweeps = unique(input.sweepEvents ?? [], (v) => v.id, (v) => v.detectedAt), fvgs = unique(input.fairValueGaps ?? [], (v) => v.id, (v) => v.detectedAt);
  unique(input.bosEvents ?? [], (v) => v.id, (v) => v.detectedAt); unique(input.transitionEvents ?? [], (v) => v.id, (v) => v.detectedAt);
  const candles = completedCandles(input.candles ?? [], reference), atrCalc = simpleAtr(candles, c.atrPeriod), atr = atrCalc.value;
  const availableSnapshots = snapshots.filter((v) => time(v.processedAt!) <= reference), explicitSnapshot = input.request.sourceStructureSnapshotId ? availableSnapshots.find((v) => v.id === input.request.sourceStructureSnapshotId) : undefined;
  const snapshot = explicitSnapshot ?? availableSnapshots.at(-1), sources: Source[] = [];
  const wantedDirection = direction === 'FOR_LONG' ? 'LOW' : 'HIGH', protectedLabel = direction === 'FOR_LONG' ? 'HL' : 'LH';
  const addProtected = (type: 'PROTECTED_SWING' | 'STRUCTURAL_INVALIDATION_LEVEL') => {
    if (!snapshot || (snapshot.bias !== (direction === 'FOR_LONG' ? 'BULLISH' : 'BEARISH'))) { warnings.push(`${type}: STRUCTURAL_CONTEXT_UNAVAILABLE`); sources.push({ type, raw: input.request.referencePrice, detectedAt: input.request.referenceTimestamp, rejectionReason: 'STRUCTURAL_CONTEXT_UNAVAILABLE', description: 'No deterministic protected structural context was available at the reference timestamp.' }); return; }
    const levels = classified(snapshot).filter((v) => v.swing.direction === wantedDirection && time(v.swing.confirmedAt) <= reference), preferred = levels.filter((v) => v.label === protectedLabel).at(-1);
    const selected = c.protectedSwingPolicy === 'ACTIVE_PROTECTED_SWING' ? preferred : levels.at(-1);
    if (!selected) { warnings.push(`${type}: STRUCTURAL_CONTEXT_UNAVAILABLE`); sources.push({ type, raw: input.request.referencePrice, detectedAt: input.request.referenceTimestamp, rejectionReason: 'STRUCTURAL_CONTEXT_UNAVAILABLE', description: 'No eligible protected swing was available at the reference timestamp.' }); return; }
    sources.push({ type, raw: selected.swing.price, detectedAt: selected.swing.confirmedAt, classifiedSwing: selected, snapshot, description: `Protected ${selected.label} at ${selected.swing.price} was confirmed before the reference timestamp.` });
  };
  if (c.enabledCandidateTypes.includes('PROTECTED_SWING')) addProtected('PROTECTED_SWING');
  if (c.enabledCandidateTypes.includes('STRUCTURAL_INVALIDATION_LEVEL')) addProtected('STRUCTURAL_INVALIDATION_LEVEL');
  if (c.enabledCandidateTypes.includes('LATEST_CONFIRMED_SWING')) {
    const structural = availableSnapshots.flatMap(classified).filter((v) => v.swing.direction === wantedDirection && time(v.swing.confirmedAt) <= reference);
    const raw = c.latestSwingPolicy === 'LATEST_ACCEPTED_STRUCTURE' ? structural.sort((a, b) => time(a.swing.confirmedAt) - time(b.swing.confirmedAt)).at(-1) : undefined;
    const plain = swings.filter((v) => v.direction === wantedDirection && time(v.confirmedAt) <= reference).at(-1), selected = raw ?? plain;
    if (selected) {
      const selectedClassified = raw ?? null, selectedConfirmed = selectedClassified?.swing ?? plain!;
      sources.push({ type: 'LATEST_CONFIRMED_SWING', raw: selectedConfirmed.price, detectedAt: selectedConfirmed.confirmedAt, classifiedSwing: selectedClassified ?? undefined, confirmedSwing: selectedClassified ? undefined : selectedConfirmed, description: `Latest eligible confirmed ${wantedDirection.toLowerCase()} at ${selectedConfirmed.price} was available before the reference timestamp.` });
    }
  }
  if (c.enabledCandidateTypes.includes('SWEEP_EXTREME')) {
    let eligible = sweeps.filter((v) => v.accepted && v.direction === (direction === 'FOR_LONG' ? 'SELL_SIDE' : 'BUY_SIDE') && time(v.detectedAt) <= reference);
    if (c.sweepSelectionPolicy === 'EXPLICIT_SOURCE_ONLY') eligible = input.request.sourceSweepEventId ? eligible.filter((v) => v.id === input.request.sourceSweepEventId) : [];
    else if (c.sweepSelectionPolicy === 'LATEST_RELEVANT') eligible = eligible.slice(-1);
    if (input.request.sourceSweepEventId && !eligible.length) { warnings.push('SWEEP_EXTREME: EXPLICIT_SOURCE_NOT_FOUND'); sources.push({ type: 'SWEEP_EXTREME', raw: input.request.referencePrice, detectedAt: input.request.referenceTimestamp, sweepId: input.request.sourceSweepEventId, rejectionReason: sweeps.some((v) => v.id === input.request.sourceSweepEventId) ? 'SOURCE_NOT_AVAILABLE_AT_REFERENCE_TIME' : 'EXPLICIT_SOURCE_NOT_FOUND', description: 'The explicit sweep source was unavailable at the reference timestamp.' }); }
    for (const sweep of eligible) sources.push({ type: 'SWEEP_EXTREME', raw: direction === 'FOR_LONG' ? sweep.low : sweep.high, detectedAt: sweep.detectedAt, sweepId: sweep.id, description: `${direction === 'FOR_LONG' ? 'Sell-side sweep low' : 'Buy-side sweep high'} at ${direction === 'FOR_LONG' ? sweep.low : sweep.high} was available before the reference timestamp.` });
  }
  if (c.enabledCandidateTypes.includes('FVG_FAR_BOUNDARY')) {
    let eligible = fvgs.filter((v) => v.direction === (direction === 'FOR_LONG' ? 'BULLISH' : 'BEARISH') && c.eligibleFvgStatuses.includes(fvgStatusAt(v, reference)!));
    if (c.fvgSelectionPolicy === 'EXPLICIT_SOURCE_ONLY') eligible = input.request.sourceFvgId ? eligible.filter((v) => v.id === input.request.sourceFvgId) : [];
    else if (c.fvgSelectionPolicy === 'NEAREST_ELIGIBLE') eligible = eligible.sort((a, b) => Math.abs((direction === 'FOR_LONG' ? a.lowerBound : a.upperBound) - input.request.referencePrice) - Math.abs((direction === 'FOR_LONG' ? b.lowerBound : b.upperBound) - input.request.referencePrice)).slice(0, 1);
    if (input.request.sourceFvgId && !eligible.length) { const found = fvgs.find((v) => v.id === input.request.sourceFvgId); warnings.push('FVG_FAR_BOUNDARY: EXPLICIT_SOURCE_NOT_FOUND_OR_INELIGIBLE'); sources.push({ type: 'FVG_FAR_BOUNDARY', raw: input.request.referencePrice, detectedAt: input.request.referenceTimestamp, fvgId: input.request.sourceFvgId, rejectionReason: !found ? 'EXPLICIT_SOURCE_NOT_FOUND' : time(found.detectedAt) > reference ? 'SOURCE_NOT_AVAILABLE_AT_REFERENCE_TIME' : 'SOURCE_TERMINAL_OR_INELIGIBLE', description: 'The explicit FVG source was unavailable or ineligible at the reference timestamp.' }); }
    for (const gap of eligible) sources.push({ type: 'FVG_FAR_BOUNDARY', raw: direction === 'FOR_LONG' ? gap.lowerBound : gap.upperBound, detectedAt: gap.detectedAt, fvgId: gap.id, description: `${gap.direction === 'BULLISH' ? 'Bullish FVG lower' : 'Bearish FVG upper'} boundary at ${direction === 'FOR_LONG' ? gap.lowerBound : gap.upperBound} was eligible at the reference timestamp.` });
  }
  if (c.enabledCandidateTypes.includes('COMBINED_STRUCTURAL_ORIGIN_FVG')) {
    const gap = input.request.sourceFvgId ? fvgs.find((v) => v.id === input.request.sourceFvgId && time(v.detectedAt) <= reference && c.eligibleFvgStatuses.includes(fvgStatusAt(v, reference)!)) : undefined;
    const origin = snapshot ? classified(snapshot).filter((v) => v.swing.direction === wantedDirection && time(v.swing.confirmedAt) <= reference).at(-1) : undefined;
    if (!gap || !origin) {
      warnings.push('COMBINED_STRUCTURAL_ORIGIN_FVG: EXPLICIT_SOURCE_NOT_FOUND_OR_INELIGIBLE');
      sources.push({ type: 'COMBINED_STRUCTURAL_ORIGIN_FVG', raw: input.request.referencePrice, detectedAt: input.request.referenceTimestamp, fvgId: input.request.sourceFvgId, snapshot, rejectionReason: !gap ? 'EXPLICIT_SOURCE_NOT_FOUND' : 'STRUCTURAL_CONTEXT_UNAVAILABLE', description: 'The governed structural-origin/FVG stop requires both an explicit eligible FVG and an accepted adverse-side origin swing.' });
    } else {
      const boundary = direction === 'FOR_LONG' ? gap.lowerBound : gap.upperBound;
      const raw = direction === 'FOR_LONG' ? Math.min(origin.swing.price, boundary) : Math.max(origin.swing.price, boundary);
      sources.push({ type: 'COMBINED_STRUCTURAL_ORIGIN_FVG', raw, detectedAt: [origin.swing.confirmedAt, gap.detectedAt].sort((a, b) => time(a) - time(b)).at(-1)!, classifiedSwing: origin, snapshot, fvgId: gap.id, transitionId: input.request.sourceTransitionEventId, description: `Governed ${direction === 'FOR_LONG' ? 'minimum' : 'maximum'} of structural origin ${origin.swing.price} and original FVG far boundary ${boundary} is ${raw}.` });
    }
  }
  let generated = sources.map((v) => { const candidate = makeCandidate(v, input.request, c, atr); return v.type === 'COMBINED_STRUCTURAL_ORIGIN_FVG' ? freeze({ ...candidate, sourceCandidateTypes: ['PROTECTED_SWING', 'FVG_FAR_BOUNDARY', 'COMBINED_STRUCTURAL_ORIGIN_FVG'] as StructuralStopCandidateType[] }) : candidate; }), rejected = generated.filter((v) => !v.valid), accepted = generated.filter((v) => v.valid);
  if (c.deduplicationPolicy === 'MERGE_SAME_EFFECTIVE_PRICE') accepted = mergeCandidates(accepted, c.deduplicationTolerance);
  accepted = ranked(accepted, c); rejected = [...rejected].sort((a, b) => a.id.localeCompare(b.id));
  return freeze({ generatorVersion: STRUCTURAL_STOP_CANDIDATE_VERSION, candidates: accepted, rejectedCandidates: rejected, warnings: [...new Set(warnings)].sort(), request: structuredClone(input.request), configuration: c });
}

export function createStructuralStopCandidateGenerator(config: Partial<StructuralStopCandidateConfig> = {}): StructuralStopCandidateGenerator {
  const configuration = configFor(config), candles: NormalizedCandle[] = [], swings: StructuralStopCandidateInput['confirmedSwings'][number][] = [], snapshots: StructuralStopCandidateInput['structureSnapshots'][number][] = [], bos: NonNullable<StructuralStopCandidateInput['bosEvents']>[number][] = [], transitions: NonNullable<StructuralStopCandidateInput['transitionEvents']>[number][] = [], sweeps: NonNullable<StructuralStopCandidateInput['sweepEvents']>[number][] = [], gaps: NonNullable<StructuralStopCandidateInput['fairValueGaps']>[number][] = [], warnings: string[] = [];
  let queryWatermark = Number.NEGATIVE_INFINITY;
  const push = <T>(values: T[], value: T, id: (v: T) => string, at: (v: T) => string) => { if (values.some((v) => id(v) === id(value))) throw new StructuralStopCandidateError('DUPLICATE_INPUT', `Duplicate ID: ${id(value)}.`); if (time(at(value)) <= queryWatermark) throw new StructuralStopCandidateError('OUT_OF_ORDER_INCREMENTAL_INPUT', 'Incremental input cannot retroactively alter an already queried reference time.'); if (values.at(-1) && time(at(value)) < time(at(values.at(-1)!))) throw new StructuralStopCandidateError('OUT_OF_ORDER_INCREMENTAL_INPUT', 'Incremental inputs must not move backward.'); values.push(freeze(structuredClone(value))); };
  return Object.freeze({
    pushCandle(v) { push(candles, v, (x) => x.openedAt, (x) => x.openedAt); }, pushConfirmedSwing(v) { push(swings, v, (x) => x.id, (x) => x.confirmedAt); }, pushStructureSnapshot(v) { if (!v.processedAt) throw new StructuralStopCandidateError('INVALID_INPUT', 'Snapshot requires processedAt.'); push(snapshots, v, (x) => x.id, (x) => x.processedAt!); },
    pushBosEvent(v) { push(bos, v, (x) => x.id, (x) => x.detectedAt); }, pushTransitionEvent(v) { push(transitions, v, (x) => x.id, (x) => x.detectedAt); }, pushSweepEvent(v) { push(sweeps, v, (x) => x.id, (x) => x.detectedAt); }, pushFairValueGapSnapshot(v) { push(gaps, v, (x) => x.id, (x) => x.detectedAt); },
    generateCandidates(request) { const result = generateStructuralStopCandidates({ request, candles, confirmedSwings: swings, structureSnapshots: snapshots, bosEvents: bos, transitionEvents: transitions, sweepEvents: sweeps, fairValueGaps: gaps, config: configuration }); queryWatermark = Math.max(queryWatermark, time(request.referenceTimestamp)); return result; },
    getWarnings() { return freeze([...warnings]); }, reset() { candles.length = swings.length = snapshots.length = bos.length = transitions.length = sweeps.length = gaps.length = warnings.length = 0; queryWatermark = Number.NEGATIVE_INFINITY; },
  });
}
export function serializeStructuralStopCandidateResult(result: StructuralStopCandidateResult): string { return canonicalStringify(result); }
