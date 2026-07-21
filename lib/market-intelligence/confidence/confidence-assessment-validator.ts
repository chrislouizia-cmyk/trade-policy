import type { EvidenceGraph } from '../evidence-graph/evidence-graph-types.ts';
import type { StrategyContext } from '../strategy-composition/composition-types.ts';
import type { CompiledStrategyDefinition } from '../strategy-definitions/strategy-definition-types.ts';
import { createConfidenceAssessmentId, normalizeConfidenceEngineConfig } from './confidence-engine.ts';
import type { ConfidenceAssessment, ConfidenceEngineConfig, ConfidenceValidationIssue, ConfidenceValidationResult } from './confidence-types.ts';

const forbidden = new Set(['decision', 'readiness', 'ready', 'approval', 'buy', 'sell', 'entry', 'entryPrice', 'stop', 'stopLoss', 'target', 'takeProfit', 'positionSize', 'payload', 'detectorPayload']);
const same = (left: number | null, right: number | null): boolean => left === right || (left !== null && right !== null && Math.abs(left - right) <= Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right)) * 8);
const list = (values: readonly string[]): string => JSON.stringify(values);

export class ConfidenceAssessmentValidator {
  validate(assessment: ConfidenceAssessment, definition: CompiledStrategyDefinition, context: StrategyContext, graph: EvidenceGraph, config: ConfidenceEngineConfig): ConfidenceValidationResult {
    const issues: ConfidenceValidationIssue[] = [], add = (code: string, path: string, message: string): void => { issues.push({ code, path, message }); };
    if (assessment.strategyId !== definition.id || assessment.strategyVersion !== definition.version || assessment.compiledStrategyId !== definition.compiledStrategyId || assessment.strategyContextId !== context.contextId || assessment.evidenceGraphId !== graph.graphId || assessment.sourceMarketContextId !== graph.marketContextId || assessment.generatedAt !== context.executionTimestamp) add('SOURCE_IDENTITY_MISMATCH', 'identity', 'Assessment source identities are inconsistent.');
    if (assessment.assessmentId !== createConfidenceAssessmentId(definition, context, graph, normalizeConfidenceEngineConfig(config))) add('ASSESSMENT_ID_MISMATCH', 'assessmentId', 'Assessment ID is not the deterministic expected value.');
    const expectedIds = definition.ruleExecutionOrder ?? [], actualIds = assessment.contributions.map((item) => item.ruleId);
    if (new Set(actualIds).size !== actualIds.length) add('DUPLICATE_CONTRIBUTION', 'contributions', 'Rule contributions must be unique.');
    if (list(actualIds) !== list(expectedIds)) add('CONTRIBUTION_ORDER_MISMATCH', 'contributions', 'Contributions must represent every enabled rule in compiled execution order.');
    const graphNodeIds = new Set(graph.nodes.map((node) => node.id));
    assessment.contributions.forEach((item, index) => {
      const configured = definition.ruleConfiguration?.[item.ruleId]?.confidenceContribution;
      if (item.configuredWeight !== configured) add('CONFIGURED_WEIGHT_MISMATCH', `contributions[${index}].configuredWeight`, 'Configured weight does not match compiled definition.');
      if (![item.configuredWeight, item.eligibleWeight, item.earnedWeight].every((value) => Number.isFinite(value) && value >= 0)) add('INVALID_WEIGHT', `contributions[${index}]`, 'Contribution weights must be finite and non-negative.');
      if (item.earnedWeight > item.eligibleWeight) add('EARNED_EXCEEDS_ELIGIBLE', `contributions[${index}].earnedWeight`, 'Earned weight cannot exceed eligible weight.');
      if (item.eligibleWeight > item.configuredWeight) add('ELIGIBLE_EXCEEDS_CONFIGURED', `contributions[${index}].eligibleWeight`, 'Eligible weight cannot exceed configured weight.');
      item.evidenceNodeIds.forEach((id) => { if (!graphNodeIds.has(id)) add('MISSING_EVIDENCE_NODE', `contributions[${index}].evidenceNodeIds`, `Evidence graph node does not exist: ${id}`); });
    });
    const configured = assessment.contributions.reduce((sum, item) => sum + item.configuredWeight, 0), eligible = assessment.contributions.reduce((sum, item) => sum + item.eligibleWeight, 0), earned = assessment.contributions.reduce((sum, item) => sum + item.earnedWeight, 0);
    if (!same(assessment.configuredWeight, configured) || !same(assessment.eligibleWeight, eligible) || !same(assessment.rawEarnedWeight, earned)) add('TOTAL_MISMATCH', 'totals', 'Assessment totals do not match contribution sums.');
    const ratio = eligible > 0 ? earned / eligible : null, coverage = configured > 0 ? eligible / configured : null;
    if (!same(assessment.confidenceRatio, ratio) || !same(assessment.confidencePercent, ratio === null ? null : ratio * 100)) add('CONFIDENCE_MISMATCH', 'confidenceRatio', 'Confidence ratio or percent does not match totals.');
    if (!same(assessment.configuredCoverageRatio, coverage) || !same(assessment.configuredCoveragePercent, coverage === null ? null : coverage * 100)) add('COVERAGE_MISMATCH', 'configuredCoverageRatio', 'Coverage ratio or percent does not match totals.');
    const by = (status: string, requirement: string): string[] => assessment.contributions.filter((item) => item.evaluationStatus === status && item.requirement === requirement).map((item) => item.ruleId);
    if (list(assessment.failedRequiredRuleIds) !== list(by('FAILED', 'REQUIRED')) || list(assessment.failedOptionalRuleIds) !== list(by('FAILED', 'OPTIONAL')) || list(assessment.unavailableRequiredRuleIds) !== list(by('NOT_EVALUATED', 'REQUIRED')) || list(assessment.unavailableOptionalRuleIds) !== list(by('NOT_EVALUATED', 'OPTIONAL')) || list(assessment.errorRuleIds) !== list(assessment.contributions.filter((item) => item.evaluationStatus === 'ERROR').map((item) => item.ruleId))) add('CLASSIFICATION_LIST_MISMATCH', 'ruleIds', 'Failure, unavailable, or error lists do not match contributions.');
    const inspect = (value: unknown, path: string): void => { if (typeof value === 'number' && !Number.isFinite(value)) add('NON_FINITE_NUMBER', path, 'Assessment cannot contain NaN or Infinity.'); if (Array.isArray(value)) value.forEach((child, index) => inspect(child, `${path}[${index}]`)); else if (value && typeof value === 'object') Object.entries(value).forEach(([key, child]) => { if (forbidden.has(key)) add('FORBIDDEN_FIELD', `${path}.${key}`, `Forbidden decision or payload field: ${key}`); inspect(child, `${path}.${key}`); }); };
    inspect(assessment, 'assessment');
    return { valid: issues.length === 0, issues };
  }
}
