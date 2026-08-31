import { createHash } from 'node:crypto';

export type InternalLifecycleScenario = 'READY' | 'SOFT_BLOCK' | 'HARD_BLOCK';

export type InternalLifecycleDecisionLineage = {
  scenario: InternalLifecycleScenario;
  sourceDecisionId: string;
  sourceReportId: string;
  verdict: 'READY' | 'BLOCKED';
  overrideEligible: boolean;
  activationMode: 'READY' | 'OVERRIDE';
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function buildInternalLifecycleDecisionSnapshot(scenario: InternalLifecycleScenario) {
  const verdict: 'READY' | 'BLOCKED' = scenario === 'READY' ? 'READY' : 'BLOCKED';
  const overrideEligible = scenario === 'SOFT_BLOCK';
  const currentTime = new Date().toISOString();
  const reportId = crypto.randomUUID();

  const snapshot = {
    schemaVersion: '1.0.0',
    reportId,
    verdict,
    readinessPercent: scenario === 'READY' ? 96 : 46,
    instrument: 'XAUUSD',
    timeframe: '1H',
    strategyName: 'INTERNAL_LIFECYCLE_SMOKE_TEST',
    strategyRevisionId: 'internal-lifecycle-v2',
    strategyVersion: 'internal-lab-v2',
    primaryReason:
      scenario === 'READY'
        ? 'Internal lifecycle smoke test uses a real READY decision lineage.'
        : scenario === 'SOFT_BLOCK'
          ? 'Internal lifecycle smoke test is blocked but override-eligible.'
          : 'Internal lifecycle smoke test is hard blocked and immutable.',
    nextAction:
      scenario === 'READY'
        ? 'ENTRY_READY'
        : scenario === 'SOFT_BLOCK'
          ? 'REVIEW_OVERRIDE'
          : 'BLOCKED',
    marketData: {
      provider: 'INTERNAL_SMOKE_TEST',
      lastVerifiedCandleAt: currentTime,
      freshness: 'SIMULATED',
    },
    finalRiskCheck: {
      overrideEligible,
      requiresReview: scenario === 'SOFT_BLOCK',
      riskLevel: scenario === 'READY' ? 'LOW' : 'CONTROLLED',
    },
    decisionSummary: {
      testScenario: scenario,
      source: 'INTERNAL_LIFECYCLE_SMOKE_TEST',
    },
    createdAt: currentTime,
  } as const;

  return {
    ...snapshot,
    deterministicFingerprint: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),
  };
}

export function assertValidInternalLifecycleSourceIds(sourceDecisionId: string | null | undefined, sourceReportId: string | null | undefined) {
  if (!sourceDecisionId || !sourceReportId) {
    throw new Error('A valid internal smoke test sourceDecisionId and sourceReportId are required.');
  }

  if (!UUID_REGEX.test(sourceDecisionId)) {
    throw new Error('sourceDecisionId must be a valid UUID for the internal smoke test lineage.');
  }

  if (!UUID_REGEX.test(sourceReportId)) {
    throw new Error('sourceReportId must be a valid UUID for the internal smoke test lineage.');
  }
}

export function getInternalLifecycleScenarioConfig(scenario: InternalLifecycleScenario): Pick<InternalLifecycleDecisionLineage, 'activationMode' | 'verdict' | 'overrideEligible'> {
  if (scenario === 'READY') {
    return {
      verdict: 'READY',
      overrideEligible: false,
      activationMode: 'READY',
    };
  }

  return {
    verdict: 'BLOCKED',
    overrideEligible: scenario === 'SOFT_BLOCK',
    activationMode: scenario === 'SOFT_BLOCK' ? 'OVERRIDE' : 'READY',
  };
}
