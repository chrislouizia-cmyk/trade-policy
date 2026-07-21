import type { ConfidenceAssessment } from '../confidence/confidence-types.ts';
import type { DecisionAssessment } from '../decision/decision-types.ts';
import type { EvidenceGraph } from '../evidence-graph/evidence-graph-types.ts';
import type { ReadinessAssessment } from '../readiness/readiness-types.ts';
import type { StrategyContext } from '../strategy-composition/composition-types.ts';
import type { CompiledStrategyDefinition } from '../strategy-definitions/strategy-definition-types.ts';
import { createDirectionAssessmentId, DirectionResolutionEngine } from './direction-resolution-engine.ts';
import type { DirectionAssessment, DirectionPolicy, DirectionValidationIssue, DirectionValidationResult } from './direction-types.ts';

const FORBIDDEN = new Set(['payload', 'entry', 'entryPrice', 'stop', 'stopLoss', 'target', 'takeProfit', 'risk', 'leverage', 'positionSize', 'sizing', 'orderType', 'broker', 'execution']);
export class DirectionAssessmentValidator {
  validate(assessment: DirectionAssessment, definition: CompiledStrategyDefinition, strategy: StrategyContext, graph: EvidenceGraph, confidence: ConfidenceAssessment, readiness: ReadinessAssessment, decision: DecisionAssessment, policy: DirectionPolicy): DirectionValidationResult {
    const issues: DirectionValidationIssue[] = [];
    const add = (code: string, path: string, message: string): void => { issues.push({ code, path, message }); };
    const expected = new DirectionResolutionEngine().assess(definition, strategy, graph, confidence, readiness, decision, policy);
    if (assessment.strategyId !== definition.id || assessment.strategyVersion !== definition.version || assessment.compiledStrategyId !== definition.compiledStrategyId || assessment.marketContextId !== graph.marketContextId || assessment.strategyContextId !== strategy.contextId || assessment.evidenceGraphId !== graph.graphId || assessment.confidenceAssessmentId !== confidence.assessmentId || assessment.readinessAssessmentId !== readiness.assessmentId || assessment.decisionAssessmentId !== decision.assessmentId || assessment.generatedAt !== strategy.executionTimestamp) add('SOURCE_IDENTITY_MISMATCH', 'identity', 'Source identities are inconsistent.');
    if (assessment.assessmentId !== createDirectionAssessmentId(definition, strategy, graph, confidence, readiness, decision, policy)) add('ASSESSMENT_ID_MISMATCH', 'assessmentId', 'Assessment ID is inconsistent with source fingerprints.');
    const ids = assessment.directionalRuleEvaluations.map((item) => item.ruleId);
    if (new Set(ids).size !== ids.length) add('DUPLICATE_DIRECTIONAL_EVALUATION', 'directionalRuleEvaluations', 'Directional evaluations must be unique.');
    if (JSON.stringify(assessment.directionalRuleEvaluations) !== JSON.stringify(expected.directionalRuleEvaluations)) add('DIRECTIONAL_EVALUATION_MISMATCH', 'directionalRuleEvaluations', 'Evaluation order, metadata, conditions, or support is inconsistent.');
    for (const [key, code] of [['buySupportingRuleIds', 'BUY_SUPPORT_MISMATCH'], ['sellSupportingRuleIds', 'SELL_SUPPORT_MISMATCH'], ['conflictedRuleIds', 'CONFLICT_LIST_MISMATCH'], ['unavailableDirectionalRuleIds', 'UNAVAILABLE_LIST_MISMATCH'], ['errorDirectionalRuleIds', 'ERROR_LIST_MISMATCH']] as const) if (JSON.stringify(assessment[key]) !== JSON.stringify(expected[key])) add(code, key, `${key} is inconsistent.`);
    if (assessment.status !== expected.status || assessment.outcome !== expected.outcome) add('STATUS_OUTCOME_MISMATCH', 'outcome', 'Status and outcome are inconsistent with deterministic precedence.');
    const direction = assessment.outcome === 'BUY' ? 'BUY' : assessment.outcome === 'SELL' ? 'SELL' : null;
    if (assessment.direction !== direction) add('DIRECTION_OUTCOME_MISMATCH', 'direction', 'Direction must correspond exactly to BUY or SELL outcome.');
    const criterionIds = assessment.criteria.map((item) => item.criterionId);
    if (new Set(criterionIds).size !== criterionIds.length) add('DUPLICATE_CRITERION', 'criteria', 'Criteria must be unique.');
    if (JSON.stringify(criterionIds) !== JSON.stringify(policy.criteriaOrder) || assessment.criteria.some((item, index) => item.order !== index)) add('CRITERION_ORDER_MISMATCH', 'criteria', 'Criteria must follow policy order.');
    const nodeIds = new Set(graph.nodes.map((node) => node.id));
    assessment.criteria.forEach((criterion, index) => criterion.relatedEvidenceNodeIds.forEach((id) => { if (!nodeIds.has(id)) add('MISSING_EVIDENCE_NODE', `criteria[${index}]`, id); }));
    assessment.directionalRuleEvaluations.forEach((evaluation, index) => evaluation.evidenceNodeIds.forEach((id) => { if (!nodeIds.has(id)) add('MISSING_EVIDENCE_NODE', `directionalRuleEvaluations[${index}]`, id); }));
    if (JSON.stringify(assessment.criteria) !== JSON.stringify(expected.criteria)) add('CRITERION_RESULT_MISMATCH', 'criteria', 'Criterion results do not match deterministic evaluation.');
    if (JSON.stringify(assessment.summary) !== JSON.stringify(expected.summary)) add('SUMMARY_MISMATCH', 'summary', 'Summary totals are inconsistent.');
    const inspect = (value: unknown, path: string): void => { if (typeof value === 'number' && !Number.isFinite(value)) add('NON_FINITE_NUMBER', path, 'Non-finite numbers are forbidden.'); if (Array.isArray(value)) value.forEach((item, index) => inspect(item, `${path}[${index}]`)); else if (value && typeof value === 'object') Object.entries(value).forEach(([key, nested]) => { if (FORBIDDEN.has(key)) add('FORBIDDEN_FIELD', `${path}.${key}`, `Forbidden field: ${key}`); inspect(nested, `${path}.${key}`); }); };
    inspect(assessment, 'assessment');
    return { valid: issues.length === 0, issues };
  }
}
