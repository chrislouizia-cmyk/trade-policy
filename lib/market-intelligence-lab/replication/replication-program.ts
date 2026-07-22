import { stableFingerprint } from '../../market-intelligence/serialization/stable-fingerprint.ts';

export const XAUUSD_REPLICATION_PROGRAM_V1 = Object.freeze({
  programId: 'TP-REP-XAUUSD-2026-01', version: '1.0.0', status: 'PREREGISTERED', pilotExperimentId: 'TP-EXP-2026-0003', strategy: Object.freeze({ id: 'gold-intraday-research', version: '1.0.0' }),
  primaryHypothesis: 'Higher Readiness predicts better forward outcomes on unseen XAUUSD data.',
  timeframes: Object.freeze(['M5', 'M15', 'H1']), periods: Object.freeze(['2018-2019', '2020-2021', '2022-2023', '2024-2025', '2026-PROSPECTIVE']),
  minimumEvidence: Object.freeze({ yearsPerTimeframe: 3, pooledOutOfSampleOpportunities: 500, approvedPerPrincipalComparison: 100, observationsPerRegime: 100, maximumPeriodContributionPercent: 40 }),
  calibrationLocked: true, productionIsolated: true,
});
export const XAUUSD_REPLICATION_PROGRAM_HASH = stableFingerprint(XAUUSD_REPLICATION_PROGRAM_V1);
