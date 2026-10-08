import { createHash } from 'node:crypto';
import { stableFingerprint } from '../../../market-intelligence/serialization/stable-fingerprint.ts';
import type { FairValueGap, FairValueGapStatus } from '../../../market-intelligence/imbalance/fair-value-gap/fair-value-gap-lifecycle-types.ts';
import type { LiquidityTargetStatus, StructuralLiquidityTarget } from '../../../market-intelligence/liquidity/targets/structural-liquidity-target-types.ts';
import type { StrategyConditionEvaluation, StrategyConditionStatus } from './composition-types.ts';
import { resolveStrategySetupStatus } from './xauusd-structure-pullback-composer.ts';
import type { DependencyAuditStatus, StrategyCompositionInputV110, StrategyCompositionResultV110, StrategyReadinessAudit } from './v1.1.0-types.ts';

export const XAUUSD_STRUCTURE_PULLBACK_V110_DNA_SHA256 = '8c2816f316bf0db4b17f2bd7ad5fbe2ce2cbad9570b153958dc7d77de6281de7';
export const XAUUSD_STRUCTURE_PULLBACK_V110_COMPOSER_VERSION = '1.1.0';
const ms = (v: string): number => { const n = Date.parse(v); if (!Number.isFinite(n)) throw new Error(`Invalid timestamp: ${v}`); return n; };
const hash = (v: string): string => createHash('sha256').update(v).digest('hex');
function freeze<T>(v: T): T { if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
function ev(id: string, type: string, status: StrategyConditionStatus, at: string, facts: string[] = [], events: string[] = [], objects: string[] = [], reason: string | null = null): StrategyConditionEvaluation {
  const base = { conditionId: id, conditionVersion: '1.1.0', conditionType: type, required: true, status, sourceEventIds: events, sourceObjectIds: objects, evaluatedAt: at, expectedRule: id, observedFacts: facts, rejectionReason: reason, evidence: facts };
  return freeze({ ...base, fingerprint: stableFingerprint(base) });
}
function fvgStatusAt(v: FairValueGap, at: number): FairValueGapStatus | null {
  if (ms(v.detectedAt) > at) return null;
  const changes: Array<[string | null, FairValueGapStatus]> = [[v.partiallyMitigatedAt, 'PARTIALLY_MITIGATED'], [v.fullyMitigatedAt, 'FULLY_MITIGATED'], [v.invalidatedAt, 'INVALIDATED'], [v.expiredAt, 'EXPIRED']];
  return changes.filter((x): x is [string, FairValueGapStatus] => Boolean(x[0]) && ms(x[0]!) <= at).sort((a, b) => ms(a[0]) - ms(b[0])).at(-1)?.[1] ?? 'ACTIVE';
}
function targetStatusAt(v: StructuralLiquidityTarget, at: number): LiquidityTargetStatus | null {
  if (ms(v.detectedAt) > at) return null;
  const changes: Array<[string | null, LiquidityTargetStatus]> = [[v.firstTestedAt, 'TESTED'], [v.sweptAt, 'SWEPT'], [v.brokenAt, 'BROKEN'], [v.invalidatedAt, 'INVALIDATED'], [v.expiredAt, 'EXPIRED']];
  return changes.filter((x): x is [string, LiquidityTargetStatus] => Boolean(x[0]) && ms(x[0]!) <= at).sort((a, b) => ms(a[0]) - ms(b[0])).at(-1)?.[1] ?? 'AVAILABLE';
}
const weekday = (v: string): number => { const day = new Date(v).getUTCDay(); return day === 0 ? 7 : day; };
function inSession(v: string): boolean {
  if (![1, 2, 3, 4, 5].includes(weekday(v))) return false;
  const d = new Date(v), minute = d.getUTCHours() * 60 + d.getUTCMinutes();
  return (minute >= 420 && minute < 960) || (minute >= 780 && minute < 1320);
}
const targetPriority: Record<StructuralLiquidityTarget['targetType'], number> = { EQUAL_HIGHS: 0, EQUAL_LOWS: 1, STRUCTURAL_HIGH: 2, STRUCTURAL_LOW: 3 };

export function composeXauusdStructurePullbackV110(input: StrategyCompositionInputV110): StrategyCompositionResultV110 {
  const ref = ms(input.referenceTimestamp), dnaHash = hash(input.strategyDna), blocking: string[] = [], invalid: string[] = [], evaluations: StrategyConditionEvaluation[] = [];
  if (dnaHash !== XAUUSD_STRUCTURE_PULLBACK_V110_DNA_SHA256) blocking.push('STRATEGY_DNA_HASH_MISMATCH');
  let identityValid = false;
  try { const dna = JSON.parse(input.strategyDna) as { id?: string; version?: string; parentStrategyVersion?: string }; identityValid = dna.id === 'xauusd-structure-pullback' && dna.version === '1.1.0' && dna.parentStrategyVersion === '1.0.0'; } catch { blocking.push('STRATEGY_DNA_INVALID_JSON'); }
  if (!identityValid) blocking.push('STRATEGY_DNA_IDENTITY_MISMATCH');
  if (input.symbol !== 'XAUUSD' || input.timeframe !== 'M15') invalid.push('INVALID_MARKET_SCOPE');
  const wanted = input.direction === 'LONG' ? 'BULLISH' : 'BEARISH', priorBias = input.direction === 'LONG' ? 'BEARISH' : 'BULLISH';
  const transitions = [...input.transitionEvents].filter((v) => v.accepted && v.direction === wanted && ['MARKET_STRUCTURE_SHIFT', 'CHOCH'].includes(v.classification) && v.priorBias === priorBias && ms(v.detectedAt) <= ref).sort((a, b) => ms(a.detectedAt) - ms(b.detectedAt) || a.id.localeCompare(b.id));
  const transition = transitions.at(-1) ?? null, snapshot = transition?.priorStructureSnapshotId ? input.structureSnapshots.find((v) => v.id === transition.priorStructureSnapshotId) ?? null : null;
  const structureIdentity = transition ? transition.transitionRegimeId ?? transition.id : null;
  evaluations.push(ev('structure.transition', 'STRUCTURE_TRANSITION', transition ? 'SATISFIED' : 'UNSATISFIED', input.referenceTimestamp, transition ? [`${transition.classification}:${transition.direction}:${transition.priorBias}`] : [], transition ? [transition.id] : [], snapshot ? [snapshot.id] : []));
  const consumed = structureIdentity ? (input.consumptionRecords ?? []).some((v) => v.structureIdentity === structureIdentity && ms(v.consumedAt) <= ref) : false;
  if (consumed) invalid.push('STRUCTURE_ALREADY_CONSUMED');
  evaluations.push(ev('structure.one-entry', 'ENTRY_CARDINALITY', consumed ? 'VIOLATED' : transition ? 'SATISFIED' : 'UNSATISFIED', input.referenceTimestamp, structureIdentity ? [structureIdentity] : []));

  const sourceIds = snapshot ? [snapshot.lastConfirmedHigh, snapshot.previousConfirmedHigh, snapshot.lastConfirmedLow, snapshot.previousConfirmedLow].filter(Boolean).map((v) => v!.swing.id) : [];
  const transitionIndex = transition ? input.candles.findIndex((c) => c.closedAt === transition.detectedAt) : -1;
  const sweeps = transition ? input.sweepEvents.filter((v) => v.accepted && v.direction === (input.direction === 'LONG' ? 'SELL_SIDE' : 'BUY_SIDE') && ms(v.detectedAt) < ms(transition.detectedAt) && sourceIds.includes(v.sourceSwingId) && transitionIndex >= 0 && transitionIndex - v.sweepCandleIndex <= 8 && transitionIndex - v.sweepCandleIndex > 0) : [];
  const sweep = sweeps.sort((a, b) => ms(a.detectedAt) - ms(b.detectedAt) || a.id.localeCompare(b.id)).at(-1) ?? null;
  evaluations.push(ev('entry.sweep', 'LIQUIDITY_SWEEP', sweep ? 'SATISFIED' : transition ? 'UNSATISFIED' : 'UNSATISFIED', input.referenceTimestamp, sweep ? [`${sweep.direction}:before:${transition!.id}`] : [], sweep ? [sweep.id] : []));

  const displacement = transition ? input.displacementObservations.find((v) => v.eventCandleTime === input.candles[transitionIndex]?.openedAt && v.timeframe === 'M15') ?? null : null;
  const displacementValid = Boolean(displacement?.displacementDetected && (input.direction === 'LONG' ? displacement.close > displacement.open : displacement!.close < displacement!.open));
  evaluations.push(ev('entry.displacement', 'DISPLACEMENT', displacementValid ? 'SATISFIED' : displacement ? 'VIOLATED' : 'UNSATISFIED', input.referenceTimestamp, displacement ? [`body:${displacement.bodySize}`, `atr:${displacement.atr}`, `ratio:${displacement.bodyToRangeRatio}`] : []));

  const gaps = transition ? input.fairValueGaps.filter((v) => v.direction === wanted && v.candle2Index === transitionIndex && v.candle3Index === transitionIndex + 1 && ['ACTIVE', 'PARTIALLY_MITIGATED'].includes(fvgStatusAt(v, ref) ?? '')) : [];
  const gap = gaps.sort((a, b) => ms(a.detectedAt) - ms(b.detectedAt) || a.id.localeCompare(b.id))[0] ?? null;
  evaluations.push(ev('entry.fvg-association', 'FVG_ASSOCIATION', gap ? 'SATISFIED' : transition ? 'UNSATISFIED' : 'UNSATISFIED', input.referenceTimestamp, gap ? [`C2:${gap.candle2Index}`, `C3:${gap.candle3Index}`] : [], [], gap ? [gap.id] : []));

  const triggerCandidates = gap ? input.candles.filter((c, index) => c.complete && index > gap.candle3Index && index - gap.candle3Index <= 20 && ms(c.closedAt) <= ref && c.high >= gap.lowerBound && c.low <= gap.upperBound && (input.direction === 'LONG' ? c.close > c.open && c.close >= gap.midpoint : c.close < c.open && c.close <= gap.midpoint)) : [];
  const trigger = triggerCandidates[0] ?? null;
  const firstTouchIndex = gap ? input.candles.findIndex((c, index) => index > gap.candle3Index && c.high >= gap.lowerBound && c.low <= gap.upperBound) : -1;
  const triggerIndex = trigger ? input.candles.indexOf(trigger) : -1;
  const triggerValid = Boolean(trigger && (firstTouchIndex < 0 || triggerIndex - firstTouchIndex <= 4));
  evaluations.push(ev('entry.rejection', 'REJECTION_TRIGGER', triggerValid ? 'SATISFIED' : trigger ? 'VIOLATED' : 'UNSATISFIED', input.referenceTimestamp, trigger ? [trigger.openedAt, `close:${trigger.close}`] : []));
  evaluations.push(ev('entry.zone-expiry', 'ZONE_EXPIRY', gap ? (triggerValid ? 'SATISFIED' : trigger ? 'VIOLATED' : 'UNSATISFIED') : 'UNSATISFIED', input.referenceTimestamp, gap ? ['20 candles after creation; 4 candles after first touch.'] : []));
  const entry = trigger ? input.candles[triggerIndex + 1] ?? null : null;
  const sessionValid = Boolean(trigger && entry && inSession(trigger.closedAt) && inSession(entry.openedAt));
  evaluations.push(ev('entry.session-and-timing', 'SESSION_ENTRY_TIMING', sessionValid ? 'SATISFIED' : trigger && !entry ? 'UNSATISFIED' : trigger ? 'VIOLATED' : 'UNSATISFIED', input.referenceTimestamp, trigger && entry ? [trigger.closedAt, entry.openedAt] : []));
  if (trigger && entry && !sessionValid) invalid.push('SESSION_INELIGIBLE_AT_TRIGGER_OR_ENTRY');

  const stop = entry && gap ? input.stopCandidates.filter((v) => v.valid && v.candidateType === 'COMBINED_STRUCTURAL_ORIGIN_FVG' && v.referenceTimestamp === trigger!.closedAt && v.referencePrice === entry.open && v.sourceFvgIds.includes(gap.id) && v.sourceTransitionEventIds.includes(transition?.id ?? '')).sort((a, b) => a.id.localeCompare(b.id))[0] ?? null : null;
  if (entry && !stop) blocking.push('COMBINED_STRUCTURAL_STOP_CAPABILITY_MISSING');
  const stopSideValid = Boolean(stop && (input.direction === 'LONG' ? stop.effectiveStopPrice < entry!.open : stop.effectiveStopPrice > entry!.open));
  evaluations.push(ev('risk.stop', 'STRUCTURAL_STOP', stopSideValid ? 'SATISFIED' : stop ? 'VIOLATED' : 'UNSATISFIED', input.referenceTimestamp, stop ? [`stop:${stop.effectiveStopPrice}`] : [], [], stop ? [stop.id] : []));
  if (stop && !stopSideValid) invalid.push('WRONG_SIDE_STOP');

  const targets = entry ? input.liquidityTargets.filter((v) => (input.direction === 'LONG' ? v.side === 'BUY_SIDE' && ['STRUCTURAL_HIGH', 'EQUAL_HIGHS'].includes(v.targetType) && v.price > entry.open : v.side === 'SELL_SIDE' && ['STRUCTURAL_LOW', 'EQUAL_LOWS'].includes(v.targetType) && v.price < entry.open) && ['AVAILABLE', 'TESTED'].includes(targetStatusAt(v, ms(entry.openedAt)) ?? '') && ms(v.detectedAt) <= ms(entry.openedAt) && v.memberCount >= (v.targetType.startsWith('EQUAL_') ? 2 : 1)) : [];
  const target = entry ? targets.sort((a, b) => Math.abs(a.price - entry.open) - Math.abs(b.price - entry.open) || targetPriority[a.targetType] - targetPriority[b.targetType] || ms(a.detectedAt) - ms(b.detectedAt) || a.id.localeCompare(b.id))[0] ?? null : null;
  evaluations.push(ev('reward.target', 'LIQUIDITY_TARGET', target ? 'SATISFIED' : entry ? 'UNSATISFIED' : 'UNSATISFIED', input.referenceTimestamp, target ? [`${target.side}:${target.targetType}:${target.price}`] : [], [], target ? [target.id] : []));
  const risk = entry && stop ? (input.direction === 'LONG' ? entry.open - stop.effectiveStopPrice : stop.effectiveStopPrice - entry.open) : null;
  const reward = entry && target ? (input.direction === 'LONG' ? target.price - entry.open : entry.open - target.price) : null;
  const rr = risk && reward && risk > 0 && reward > 0 ? reward / risk : null, rrValid = rr !== null && rr >= 2;
  evaluations.push(ev('reward.minimum-rr', 'MINIMUM_REWARD_TO_RISK', rrValid ? 'SATISFIED' : rr === null ? 'UNSATISFIED' : 'VIOLATED', input.referenceTimestamp, rr === null ? [] : [`rr:${rr}`]));
  if (rr !== null && !rrValid) invalid.push('NEAREST_TARGET_FAILS_MINIMUM_RR');
  evaluations.push(ev('setup.invalidation', 'SETUP_INVALIDATION', 'SATISFIED', input.referenceTimestamp, ['Explicit terminal FVG, opposing transition, origin close, target terminal, expiry, session, and consumption rules.']));
  evaluations.push(ev('exit.maximum-holding', 'MAXIMUM_HOLDING', 'SATISFIED', input.referenceTimestamp, ['Entry candle counts as 1; exit at candle 32 close.']));
  evaluations.push(ev('exit.precedence', 'EXIT_PRECEDENCE', 'SATISFIED', input.referenceTimestamp, ['STRUCTURAL_CLOSE_INVALIDATION>STOP>TARGET>MAXIMUM_HOLDING']));
  evaluations.push(ev('execution.assumptions', 'EXECUTION_ASSUMPTIONS', 'SATISFIED', input.referenceTimestamp, ['Next-open; midpoint composition; execution costs separate; governed gap fills.']));
  const status = resolveStrategySetupStatus(evaluations.map((v) => v.status), { blocking, invalid });
  const base = { version: '1.1.0' as const, strategyId: 'xauusd-structure-pullback' as const, strategyVersion: '1.1.0' as const, strategyDnaHash: dnaHash, direction: input.direction, status, structureIdentity, transitionEventId: transition?.id ?? null, sweepEventId: sweep?.id ?? null, fvgId: gap?.id ?? null, triggerCandleOpenedAt: trigger?.openedAt ?? null, entryCandleOpenedAt: entry?.openedAt ?? null, entryPrice: entry?.open ?? null, stopCandidateId: stop?.id ?? null, stopPrice: stop?.effectiveStopPrice ?? null, targetId: target?.id ?? null, targetPrice: target?.price ?? null, rewardToRisk: rr, conditionEvaluations: evaluations, blockingReasons: [...new Set(blocking)], invalidationReasons: [...new Set(invalid)] };
  const setup = freeze({ ...base, id: `preregistered-setup:${stableFingerprint(base)}`, fingerprint: stableFingerprint(base) });
  const resultBase = { strategyId: 'xauusd-structure-pullback' as const, strategyVersion: '1.1.0' as const, strategyDnaHash: dnaHash, setup };
  return freeze({ ...resultBase, fingerprint: stableFingerprint(resultBase) });
}

export function auditXauusdStructurePullbackV110(strategyDna: string): StrategyReadinessAudit {
  const dnaHash = hash(strategyDna), dependencies: DependencyAuditStatus[] = [
    ['confirmed-swing', 'SUPPORTED', 'confirmed-swing@1.0.0'], ['structure', 'SUPPORTED', 'structure-state@1.0.0'], ['bos', 'SUPPORTED', 'confirmed-structure-bos@1.0.0'],
    ['mss-choch', 'SUPPORTED', 'market-structure-shift@1.0.0'], ['sweep', 'SUPPORTED', 'structural-liquidity-sweep@1.0.0'], ['displacement', 'SUPPORTED', 'displacement@1.0.0'],
    ['fvg', 'SUPPORTED', 'fair-value-gap-lifecycle@1.0.0'], ['stop', 'SUPPORTED', 'structural-stop-candidate@1.0.0'], ['target', 'SUPPORTED', 'structural-liquidity-target@1.0.0'],
  ].map(([dependency, status, implementation]) => ({ dependency, status, implementation })) as DependencyAuditStatus[];
  const blocking = dnaHash === XAUUSD_STRUCTURE_PULLBACK_V110_DNA_SHA256 ? ['STRUCTURAL_EXECUTION_ADAPTER_NOT_IMPLEMENTED', 'IMMUTABLE_CONSUMPTION_LEDGER_NOT_INTEGRATED'] : ['STRATEGY_DNA_HASH_MISMATCH'];
  const base = { strategyId: 'xauusd-structure-pullback', strategyVersion: '1.1.0', strategyDnaHash: dnaHash, mandatoryRuleCount: 15, executableRuleCount: 15, unsupportedRuleCount: 0, ambiguousRuleCount: 0, detectorDependencies: dependencies, compositionSupported: true, executionMappingReady: false, officialBacktestAllowed: false, blockingReasons: blocking };
  return freeze({ ...base, fingerprint: stableFingerprint(base) });
}
