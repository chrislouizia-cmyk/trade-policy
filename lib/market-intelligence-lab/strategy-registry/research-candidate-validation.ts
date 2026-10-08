import { canonicalStringify, stableFingerprint } from '../../market-intelligence/serialization/stable-fingerprint.ts';

export type DependencyStatus = 'SUPPORTED' | 'PARTIALLY_SUPPORTED' | 'UNSUPPORTED';
export type ResearchCandidateStatus = 'READY_FOR_RESEARCH' | 'DETECTOR_IMPLEMENTATION_REQUIRED';

export type StrategyDependency = Readonly<{
  concept: string;
  status: DependencyStatus;
  implementation: string | null;
  reason: string;
  required: boolean;
}>;

export type ResearchStrategyCandidate = Readonly<{
  id: string;
  version: string;
  status: ResearchCandidateStatus;
  instrument: string;
  primaryTimeframe: string;
  direction: 'LONG' | 'SHORT' | 'BOTH';
  hypothesis: string;
  dependencies: readonly StrategyDependency[];
  entry: unknown;
  stop: unknown;
  target: unknown;
  invalidation: unknown;
  maximumHolding: unknown;
  sessions: unknown;
  minimumRewardToRisk: number;
  executionAssumptions: Readonly<{ source: string; assumptionsVersion: string } & Record<string, unknown>>;
  researchMetadata: Readonly<Record<string, unknown>>;
  substitutions: readonly unknown[];
  executableMapping: null | Readonly<Record<string, unknown>>;
}>;

export type CandidateValidation = Readonly<{
  valid: boolean;
  status: ResearchCandidateStatus;
  issues: readonly string[];
  strategyHash: string;
  canonicalStrategy: string;
}>;

const requiredConcepts = Object.freeze([
  'swing-high',
  'swing-low',
  'break-of-structure',
  'market-structure-shift',
  'fair-value-gap',
  'liquidity-sweep',
  'structural-stop-placement',
  'liquidity-target-detection',
]);

function populated(value: unknown): boolean {
  return value !== null && value !== undefined && (!(typeof value === 'string') || value.trim().length > 0);
}

export function validateResearchStrategyCandidate(candidate: ResearchStrategyCandidate): CandidateValidation {
  const issues: string[] = [];
  if (!candidate.id || !candidate.version || !candidate.instrument || !candidate.primaryTimeframe) issues.push('Strategy identity and market scope must be complete.');
  for (const field of ['entry', 'stop', 'target', 'invalidation', 'maximumHolding', 'sessions'] as const) if (!populated(candidate[field])) issues.push(`Strategy ${field} must be deterministic and explicit.`);
  if (!['LONG', 'SHORT', 'BOTH'].includes(candidate.direction)) issues.push('Strategy direction must be explicit.');
  if (!(candidate.minimumRewardToRisk > 0)) issues.push('Minimum reward-to-risk must be positive.');
  if (!candidate.executionAssumptions?.assumptionsVersion || candidate.executionAssumptions.source !== 'EXPLICIT_IMMUTABLE_STRATEGY') issues.push('Versioned explicit execution assumptions are required.');
  if (canonicalStringify(candidate).includes('DEMONSTRATION_DEFAULT')) issues.push('Demonstration defaults are prohibited.');
  if (candidate.substitutions.length) issues.push('Silent or approximate detector substitutions are prohibited.');
  const dependencyByConcept = new Map(candidate.dependencies.map((dependency) => [dependency.concept, dependency]));
  for (const concept of requiredConcepts) if (!dependencyByConcept.has(concept)) issues.push(`Dependency status is missing for ${concept}.`);
  const incompleteDependencies = candidate.dependencies.filter((dependency) => dependency.required && dependency.status !== 'SUPPORTED');
  const expectedStatus: ResearchCandidateStatus = incompleteDependencies.length ? 'DETECTOR_IMPLEMENTATION_REQUIRED' : 'READY_FOR_RESEARCH';
  if (candidate.status !== expectedStatus) issues.push(`Candidate status must be ${expectedStatus}.`);
  if (candidate.status === 'READY_FOR_RESEARCH' && !candidate.executableMapping) issues.push('A ready strategy requires a complete executable mapping.');
  if (candidate.status === 'DETECTOR_IMPLEMENTATION_REQUIRED' && candidate.executableMapping) issues.push('Executable mapping must not be created while required dependencies are incomplete.');
  return Object.freeze({
    valid: issues.length === 0,
    status: expectedStatus,
    issues: Object.freeze(issues),
    strategyHash: stableFingerprint(candidate),
    canonicalStrategy: canonicalStringify(candidate),
  });
}
