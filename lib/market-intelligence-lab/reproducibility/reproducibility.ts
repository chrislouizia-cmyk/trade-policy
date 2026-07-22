import { stableFingerprint } from '../../market-intelligence/serialization/stable-fingerprint.ts';
import type { EngineValidationProtocol } from '../../market-intelligence/engine-validation/validation-types.ts';
import type { ReproducibilityAssessment, ReproducibilityCriterion, ResearchArtifactProvenance } from './reproducibility-types.ts';

export const VALIDATION_FRAMEWORK_VERSION = '1.0.0';
export const EXPLAINABILITY_FRAMEWORK_VERSION = '1.0.0';
export function createValidationConfigurationHash(protocol: EngineValidationProtocol, detectorIds: readonly string[], compiledStrategyId: string): string { return stableFingerprint({ protocol, detectorIds: [...detectorIds], compiledStrategyId }); }
export function assessReproducibility(provenance: ResearchArtifactProvenance, expected: { datasetId: string; datasetHash: string; detectorIds: readonly string[]; randomSeed: number; configurationHash: string }): ReproducibilityAssessment {
  const issues: string[] = [], fullFields = [provenance.experimentId, provenance.datasetId, provenance.datasetHash, provenance.strategyId, provenance.strategyVersion, provenance.compiledStrategyId, provenance.strategyDefinitionHash, provenance.pipelineVersion, provenance.decisionPolicyVersion, provenance.readinessPolicyVersion, provenance.directionPolicyVersion, provenance.validationFrameworkVersion, provenance.explainabilityFrameworkVersion, provenance.gitCommitSha, provenance.configurationHash, provenance.executionTimestamp, provenance.executionEnvironment.runtime, provenance.executionEnvironment.runtimeVersion, provenance.executionEnvironment.operatingSystem, provenance.executionEnvironment.architecture, provenance.executionEnvironment.deployment, provenance.executionEnvironment.timezone];
  if (!/^TP-EXP-\d{4}-\d{4,}$/.test(provenance.experimentId)) issues.push('Experiment ID must use TP-EXP-YYYY-NNNN format.');
  if (provenance.datasetId !== expected.datasetId) issues.push('Provenance dataset ID does not match the validation dataset.');
  if (provenance.datasetHash !== expected.datasetHash) issues.push('Provenance dataset hash does not match the validation dataset.');
  if (provenance.randomSeed !== expected.randomSeed) issues.push('Provenance random seed does not match the statistical protocol.');
  if (provenance.configurationHash !== expected.configurationHash) issues.push('Provenance configuration hash is invalid.');
  if (!/^[0-9a-f]{7,64}$/i.test(provenance.gitCommitSha)) issues.push('Git commit SHA is missing or invalid.');
  if (!Number.isFinite(Date.parse(provenance.executionTimestamp))) issues.push('Execution timestamp is invalid.');
  if (!Object.keys(provenance.detectorVersions).length || Object.values(provenance.detectorVersions).some((version) => !version.trim())) issues.push('Detector version provenance is incomplete.');
  if (expected.detectorIds.some((id) => !provenance.detectorVersions[id])) issues.push('One or more executed detector versions are missing from provenance.');
  if (provenance.validationFrameworkVersion !== VALIDATION_FRAMEWORK_VERSION || provenance.explainabilityFrameworkVersion !== EXPLAINABILITY_FRAMEWORK_VERSION) issues.push('Validation or explainability framework version does not match this implementation.');
  if (fullFields.some((value) => !value.trim())) issues.push('One or more required provenance fields are empty.');
  const frozenEngine = [provenance.pipelineVersion, provenance.decisionPolicyVersion, provenance.readinessPolicyVersion, provenance.directionPolicyVersion, provenance.validationFrameworkVersion, provenance.explainabilityFrameworkVersion].every((value) => /^\d+\.\d+\.\d+$/.test(value));
  const criteria: ReproducibilityCriterion[] = [
    { id: 'DATASET_CERTIFIED', passed: provenance.datasetCertification === 'CERTIFIED' && provenance.datasetId === expected.datasetId && provenance.datasetHash === expected.datasetHash, explanation: 'Dataset is certified and its identity and content hash match.' },
    { id: 'IMMUTABLE_STRATEGY', passed: provenance.strategyImmutable === true && Boolean(provenance.compiledStrategyId && provenance.strategyDefinitionHash), explanation: 'Strategy references an immutable compiled definition.' },
    { id: 'FROZEN_ENGINE', passed: frozenEngine, explanation: 'Pipeline, detector-policy, validation, and explainability versions are frozen.' },
    { id: 'DETERMINISTIC_REPLAY', passed: provenance.deterministicReplay === true, explanation: 'Historical replay is declared deterministic.' },
    { id: 'FULL_PROVENANCE', passed: issues.length === 0, explanation: 'All required provenance fields are present and internally consistent.' },
    { id: 'FIXED_RANDOM_SEED', passed: Number.isSafeInteger(provenance.randomSeed) && provenance.randomSeed === expected.randomSeed, explanation: 'The statistical random seed is fixed and matches the protocol.' },
    { id: 'LOCKED_STATISTICAL_PROTOCOL', passed: provenance.statisticalProtocolLocked === true && provenance.configurationHash === expected.configurationHash, explanation: 'The statistical protocol and configuration fingerprint are locked.' },
  ];
  const score = Math.round(criteria.filter((item) => item.passed).length / criteria.length * 100);
  return Object.freeze({ score, fullyReproducible: score === 100 && issues.length === 0, criteria: Object.freeze(criteria), issues: Object.freeze(issues) });
}
