import { stableFingerprint } from '../../market-intelligence/serialization/stable-fingerprint.ts';

export const XAUUSD_REPLICATION_PROGRAM_V1 = Object.freeze({
  programId: 'TP-REP-XAUUSD-2026-01', version: '1.0.0', status: 'PREREGISTERED', pilotExperimentId: 'TP-EXP-2026-0003', strategy: Object.freeze({ id: 'gold-intraday-research', version: '1.0.0' }),
  primaryHypothesis: 'Higher Readiness predicts better forward outcomes on unseen XAUUSD data.',
  timeframes: Object.freeze(['M5', 'M15', 'H1']), periods: Object.freeze(['2018-2019', '2020-2021', '2022-2023', '2024-2025', '2026-PROSPECTIVE']),
  minimumEvidence: Object.freeze({ yearsPerTimeframe: 3, pooledOutOfSampleOpportunities: 500, approvedPerPrincipalComparison: 100, observationsPerRegime: 100, maximumPeriodContributionPercent: 40 }),
  overallRegimeMethod: Object.freeze({ id: 'DAILY_SMA20_ENDPOINT_CHANGE_V1', bullishAtOrAbovePercent: 8, bearishAtOrBelowPercent: -8 }),
  localRegimeMethod: Object.freeze({ id: 'LOCAL_SMA20_SLOPE_PRICE_V1', period: 20, bullish: 'late SMA20 > early SMA20 and current close > late SMA20', bearish: 'late SMA20 < early SMA20 and current close < late SMA20', range: 'otherwise' }),
  fixedProtocol: Object.freeze({ horizonCandles: 4, warmupCandles: 30, sampleStride: 4, minimumReturnBps: 2, confidenceLevel: .95, bootstrapIterations: 2_000, calibrationFraction: .7, seed: 123456 }),
  calibrationLocked: true, engineFrozenUntilProgramComplete: true, productionIsolated: true,
});
export const XAUUSD_REPLICATION_PROGRAM_HASH = stableFingerprint(XAUUSD_REPLICATION_PROGRAM_V1);
