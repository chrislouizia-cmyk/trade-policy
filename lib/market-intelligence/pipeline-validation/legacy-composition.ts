import type { BreakOfStructureObservation, LiquiditySweepObservation, RangeLevelsObservation } from '../contracts.ts';
import type { EvidenceSource, PipelineCompositionProjection } from './pipeline-types.ts';

type RoleObservation = { timeframe: string; bos: BreakOfStructureObservation | null; sweep: LiquiditySweepObservation | null };
export function composeLegacyPremiumDiscount(direction: 'BUY'|'SELL'|null, entry: RangeLevelsObservation | null, executionClose: number | null): boolean { return Boolean(direction) && entry !== null && executionClose !== null && (executionClose > (entry.recentHigh + entry.recentLow) / 2) === (direction === 'BUY'); }
export function composeLegacyChoch(direction: 'BUY'|'SELL'|null, observations: readonly RoleObservation[]): { directionalSweep: EvidenceSource; directionalBos: EvidenceSource; chochConfirmed: boolean } {
  const sweepFrames = direction === 'BUY' ? observations.filter((item) => item.sweep?.lowSideSweep).map((item) => item.timeframe) : direction === 'SELL' ? observations.filter((item) => item.sweep?.highSideSweep).map((item) => item.timeframe) : [];
  const bosFrames = direction === 'BUY' ? observations.filter((item) => item.bos?.bullishBreak).map((item) => item.timeframe) : direction === 'SELL' ? observations.filter((item) => item.bos?.bearishBreak).map((item) => item.timeframe) : [];
  return { directionalSweep: { satisfied: sweepFrames.length > 0, timeframes: [...new Set(sweepFrames)] }, directionalBos: { satisfied: bosFrames.length > 0, timeframes: [...new Set(bosFrames)] }, chochConfirmed: sweepFrames.length > 0 && bosFrames.length > 0 };
}
export function composeProjection(direction: 'BUY'|'SELL'|null, aligned: boolean, observations: readonly RoleObservation[], entry: RangeLevelsObservation | null, executionClose: number | null): PipelineCompositionProjection { const choch = composeLegacyChoch(direction, observations); return { direction, aligned, ...choch, premiumDiscount: composeLegacyPremiumDiscount(direction, entry, executionClose), premiumDiscountEquilibrium: entry ? (entry.recentHigh + entry.recentLow) / 2 : null, premiumDiscountExecutionClose: executionClose }; }
