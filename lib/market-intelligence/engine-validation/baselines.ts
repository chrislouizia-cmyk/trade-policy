import { stableFingerprint } from '../serialization/stable-fingerprint.ts';
import { bootstrapDifference } from './statistics.ts';
import { classificationMetrics } from './metrics.ts';
import type { BaselineResult, EngineValidationProtocol, ValidationOpportunity } from './validation-types.ts';

const average = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
const outcomes = (rows: readonly ValidationOpportunity[], approved: (row: ValidationOpportunity) => boolean): number[] => rows.filter((row) => approved(row) && row.successful !== null).map((row) => row.successful ? 1 : 0);

export function randomSelectionBaseline(rows: readonly ValidationOpportunity[], engineCoverage: number, protocol: EngineValidationProtocol): BaselineResult {
  const ranked = [...rows].sort((a, b) => stableFingerprint({ seed: protocol.seed, id: a.id }).localeCompare(stableFingerprint({ seed: protocol.seed, id: b.id })));
  const selected = new Set(ranked.slice(0, Math.round(ranked.length * engineCoverage)).map((row) => row.id));
  const approval = (row: ValidationOpportunity) => selected.has(row.id), metrics = classificationMetrics(rows, protocol, approval);
  return { id: 'RANDOM_SELECTION', description: 'Deterministic hash-ranked selection at the engine holdout coverage; it tests whether engine filtering beats selection unrelated to market evidence.', metrics, differenceInSuccessRate: bootstrapDifference(outcomes(rows, (row) => row.approved), outcomes(rows, approval), protocol.bootstrapIterations, protocol.seed + 101, protocol.confidenceLevel) };
}

export function smaBaseline(rows: readonly ValidationOpportunity[], closesByOpportunity: ReadonlyMap<string, readonly number[]>, protocol: EngineValidationProtocol): BaselineResult {
  const signals = new Map<string, { direction: 'BUY' | 'SELL'; successful: boolean; directionalReturnBps: number }>();
  for (const row of rows) {
    const closes = closesByOpportunity.get(row.id) ?? [];
    if (closes.length < 24) continue;
    const fast = average(closes.slice(-10)), slow = average(closes.slice(-24));
    const direction = fast > slow && closes.at(-1)! > slow ? 'BUY' : fast < slow && closes.at(-1)! < slow ? 'SELL' : null;
    if (!direction) continue;
    const signed = row.forwardReturnBps * (direction === 'BUY' ? 1 : -1);
    signals.set(row.id, { direction, successful: signed > protocol.minimumReturnBps, directionalReturnBps: signed });
  }
  const adapted: ValidationOpportunity[] = rows.map((row) => { const signal = signals.get(row.id); return { ...row, direction: signal?.direction ?? null, successful: signal?.successful ?? null, directionalReturnBps: signal?.directionalReturnBps ?? null, approved: Boolean(signal) }; });
  const metrics = classificationMetrics(adapted, protocol);
  return { id: 'SMA_10_24', description: 'Simple SMA(10/24) directional baseline using only candles available at evaluation time.', metrics, differenceInSuccessRate: bootstrapDifference(outcomes(rows, (row) => row.approved), [...signals.values()].map((value) => value.successful ? 1 : 0), protocol.bootstrapIterations, protocol.seed + 202, protocol.confidenceLevel) };
}
