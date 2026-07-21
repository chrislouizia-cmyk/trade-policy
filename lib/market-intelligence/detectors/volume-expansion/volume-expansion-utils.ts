import type { NormalizedCandle, VolumeExpansionObservation } from '../../contracts.ts';

export const LEGACY_VOLUME_EXPANSION_MULTIPLIER = 1.15 as const;

/** Exact legacy two-candle volume comparison; derived values are descriptive only. */
export function calculateLegacyVolumeExpansion(timeframe: string, previous: NormalizedCandle, current: NormalizedCandle): VolumeExpansionObservation {
  const currentVolume = Number.isFinite(current.volume) ? current.volume : null;
  const previousVolume = Number.isFinite(previous.volume) ? previous.volume : null;
  const volumeAvailable = currentVolume !== null && previousVolume !== null;
  const expansionDetected = volumeAvailable && currentVolume > previousVolume * LEGACY_VOLUME_EXPANSION_MULTIPLIER;
  const thresholdVolume = previousVolume === null ? null : previousVolume * LEGACY_VOLUME_EXPANSION_MULTIPLIER;
  const volumeIncrease = volumeAvailable ? currentVolume - previousVolume : null;
  const volumeRatio = !volumeAvailable || previousVolume === 0 ? null : currentVolume / previousVolume;
  const volumeChangePercent = !volumeAvailable || previousVolume === 0 ? null : (currentVolume - previousVolume) / Math.abs(previousVolume) * 100;
  return { timeframe, classification: expansionDetected ? 'EXPANDED' : 'NOT_EXPANDED', expansionDetected, volumeAvailable, currentVolume, previousVolume, multiplier: LEGACY_VOLUME_EXPANSION_MULTIPLIER, thresholdVolume, volumeIncrease, volumeRatio, volumeChangePercent, candleCount: 2, sourceStartTime: previous.openedAt, sourceEndTime: current.openedAt, previousCandleTime: previous.openedAt, eventCandleTime: current.openedAt };
}
