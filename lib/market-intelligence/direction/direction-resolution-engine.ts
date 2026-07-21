import type { ConfidenceAssessment } from '../confidence/confidence-types.ts';
import type { DecisionAssessment } from '../decision/decision-types.ts';
import type { EvidenceGraph } from '../evidence-graph/evidence-graph-types.ts';
import type { ReadinessAssessment } from '../readiness/readiness-types.ts';
import { stableFingerprint } from '../serialization/stable-fingerprint.ts';
import type { RuleEvaluationResult, StrategyContext } from '../strategy-composition/composition-types.ts';
import type { CompiledStrategyDefinition, DirectionalRuleCondition } from '../strategy-definitions/strategy-definition-types.ts';
import { DirectionPolicyValidator } from './direction-policy-validator.ts';
import type { DirectionAssessment, DirectionCriterionId, DirectionCriterionResult, DirectionOutcome, DirectionPolicy, DirectionStatus, DirectionalRuleEvaluation } from './direction-types.ts';

export const DIRECTION_ENGINE_VERSION = '1.0.0' as const;
const NAMES: Record<DirectionCriterionId, string> = { 'upstream-validity': 'Upstream validity', 'decision-permission': 'Decision permission', 'direction-configuration': 'Direction configuration', 'direction-mode': 'Direction mode', 'directional-rules': 'Directional rules', 'required-directional-rules': 'Required directional rules', 'directional-rule-errors': 'Directional rule errors', 'minimum-support': 'Minimum support', 'buy-support': 'BUY support', 'sell-support': 'SELL support', 'conflict-resolution': 'Conflict resolution' };
const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];
function deepFreeze<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; }
function conditionMatches(condition: DirectionalRuleCondition, result: RuleEvaluationResult): boolean { return condition.type === 'RULE_STATUS' ? result.status === condition.status : result.matched === condition.matched; }

export function createDirectionAssessmentId(definition: CompiledStrategyDefinition, strategy: StrategyContext, graph: EvidenceGraph, confidence: ConfidenceAssessment, readiness: ReadinessAssessment, decision: DecisionAssessment, policy: DirectionPolicy): string {
  return `direction:${stableFingerprint({ compiledStrategyId: definition.compiledStrategyId, strategyContextId: strategy.contextId, evidenceGraphId: graph.graphId, confidenceAssessmentId: confidence.assessmentId, readinessAssessmentId: readiness.assessmentId, decisionAssessmentId: decision.assessmentId, directionConfigurationFingerprint: stableFingerprint(definition.directionConfiguration ?? null), policyFingerprint: stableFingerprint(policy), requestedAt: strategy.executionTimestamp, engineVersion: DIRECTION_ENGINE_VERSION })}`;
}

type Sources = { definition: CompiledStrategyDefinition; strategy: StrategyContext; graph: EvidenceGraph; confidence: ConfidenceAssessment; readiness: ReadinessAssessment; decision: DecisionAssessment; policy: DirectionPolicy };
type Resolution = { status: DirectionStatus; outcome: DirectionOutcome; direction: 'BUY' | 'SELL' | null; evaluations: DirectionalRuleEvaluation[]; warnings: string[]; inputValid: boolean; decisionPermitted: boolean; modeAllowed: boolean };

export class DirectionResolutionEngine {
  assess(definition: CompiledStrategyDefinition, strategy: StrategyContext, graph: EvidenceGraph, confidence: ConfidenceAssessment, readiness: ReadinessAssessment, decision: DecisionAssessment, policy: DirectionPolicy): DirectionAssessment {
    const sources = { definition, strategy, graph, confidence, readiness, decision, policy };
    const inputError = this.inputError(sources);
    if (inputError) return this.build(sources, { status: 'ERROR', outcome: 'ERROR', direction: null, evaluations: [], warnings: [inputError], inputValid: false, decisionPermitted: false, modeAllowed: false });
    const configuration = definition.directionConfiguration;
    if (!configuration) return this.build(sources, { status: policy.noSupportBehavior === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'NOT_RESOLVED', outcome: policy.noSupportBehavior, direction: null, evaluations: [], warnings: ['Strategy has no direction configuration.'], inputValid: true, decisionPermitted: false, modeAllowed: false });
    if (decision.outcome === 'ERROR') return this.build(sources, { status: 'ERROR', outcome: 'ERROR', direction: null, evaluations: [], warnings: ['DecisionAssessment is ERROR.'], inputValid: true, decisionPermitted: false, modeAllowed: false });
    if (decision.outcome === 'UNAVAILABLE') return this.build(sources, { status: 'UNAVAILABLE', outcome: 'UNAVAILABLE', direction: null, evaluations: [], warnings: ['DecisionAssessment is unavailable.'], inputValid: true, decisionPermitted: false, modeAllowed: false });
    const directionEligibleOutcome = decision.outcome === 'ACTIONABLE' || (decision.outcome === 'NO_ACTION' && policy.metadata.diagnostic === true);
    const decisionPermitted = directionEligibleOutcome && policy.allowedDecisionOutcomes.includes(decision.outcome) && (!policy.requireActionableDecision || decision.outcome === 'ACTIONABLE');
    if (!decisionPermitted) return this.build(sources, { status: 'NOT_RESOLVED', outcome: 'NO_DIRECTION', direction: null, evaluations: [], warnings: ['Decision outcome does not permit direction resolution.'], inputValid: true, decisionPermitted: false, modeAllowed: false });
    const modeAllowed = configuration.mode === 'FIXED' ? policy.allowFixedDirection : configuration.mode === 'RULE_DERIVED' ? policy.allowRuleDerivedDirection : policy.allowDualScenario;
    if (!modeAllowed) return this.build(sources, { status: 'ERROR', outcome: 'ERROR', direction: null, evaluations: [], warnings: [`Direction mode ${configuration.mode} is forbidden by policy.`], inputValid: true, decisionPermitted: true, modeAllowed: false });
    if (configuration.mode === 'FIXED') {
      if (configuration.fixedDirection !== 'BUY' && configuration.fixedDirection !== 'SELL') return this.build(sources, { status: 'ERROR', outcome: 'ERROR', direction: null, evaluations: [], warnings: ['FIXED mode has no valid fixed direction.'], inputValid: true, decisionPermitted: true, modeAllowed: true });
      return this.build(sources, { status: 'RESOLVED', outcome: configuration.fixedDirection, direction: configuration.fixedDirection, evaluations: [], warnings: [], inputValid: true, decisionPermitted: true, modeAllowed: true });
    }
    const evaluationResult = this.evaluateRules(definition, strategy, confidence);
    if (evaluationResult.error !== undefined) return this.build(sources, { status: 'ERROR', outcome: 'ERROR', direction: null, evaluations: evaluationResult.evaluations, warnings: [evaluationResult.error], inputValid: true, decisionPermitted: true, modeAllowed: true });
    const evaluations = evaluationResult.evaluations;
    const unavailable = evaluations.filter((item) => item.sourceEvaluationStatus === 'NOT_EVALUATED');
    const errors = evaluations.filter((item) => item.sourceEvaluationStatus === 'ERROR');
    const requiredFailed = evaluations.filter((item) => item.required && item.sourceEvaluationStatus === 'FAILED');
    const requiredUnavailable = unavailable.filter((item) => item.required);
    if (errors.length && policy.blockOnDirectionalRuleError) return this.build(sources, { status: 'ERROR', outcome: 'ERROR', direction: null, evaluations, warnings: ['Directional rule error is blocking.'], inputValid: true, decisionPermitted: true, modeAllowed: true });
    if (requiredUnavailable.length && !policy.allowUnavailableDirectionalRules) return this.build(sources, { status: 'UNAVAILABLE', outcome: 'UNAVAILABLE', direction: null, evaluations, warnings: ['Required directional evidence is unavailable.'], inputValid: true, decisionPermitted: true, modeAllowed: true });
    if (requiredFailed.length && policy.blockOnRequiredDirectionalRuleFailure) return this.build(sources, { status: 'NOT_RESOLVED', outcome: 'NO_DIRECTION', direction: null, evaluations, warnings: ['Required directional rule failed.'], inputValid: true, decisionPermitted: true, modeAllowed: true });
    const buy = unique(evaluations.filter((item) => item.supportsBuy).map((item) => item.ruleId));
    const sell = unique(evaluations.filter((item) => item.supportsSell).map((item) => item.ruleId));
    if (buy.length && sell.length) {
      const behavior = configuration.conflictBehavior ?? policy.conflictBehavior;
      const result = behavior === 'ERROR' ? { status: 'ERROR', outcome: 'ERROR' } as const : behavior === 'NO_DIRECTION' ? { status: 'NOT_RESOLVED', outcome: 'NO_DIRECTION' } as const : { status: 'CONFLICTED', outcome: 'CONFLICTED' } as const;
      return this.build(sources, { ...result, direction: null, evaluations, warnings: [], inputValid: true, decisionPermitted: true, modeAllowed: true });
    }
    const supportCount = Math.max(buy.length, sell.length);
    if (supportCount < policy.minimumDirectionalSupportCount) return this.build(sources, { status: policy.noSupportBehavior === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'NOT_RESOLVED', outcome: policy.noSupportBehavior, direction: null, evaluations, warnings: ['Minimum directional support was not met.'], inputValid: true, decisionPermitted: true, modeAllowed: true });
    if (buy.length) return this.build(sources, { status: 'RESOLVED', outcome: 'BUY', direction: 'BUY', evaluations, warnings: [], inputValid: true, decisionPermitted: true, modeAllowed: true });
    if (sell.length) return this.build(sources, { status: 'RESOLVED', outcome: 'SELL', direction: 'SELL', evaluations, warnings: [], inputValid: true, decisionPermitted: true, modeAllowed: true });
    return this.build(sources, { status: policy.noSupportBehavior === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'NOT_RESOLVED', outcome: policy.noSupportBehavior, direction: null, evaluations, warnings: [], inputValid: true, decisionPermitted: true, modeAllowed: true });
  }

  private evaluateRules(definition: CompiledStrategyDefinition, strategy: StrategyContext, confidence: ConfidenceAssessment): { evaluations: DirectionalRuleEvaluation[]; error?: string } {
    const order = new Map((definition.ruleExecutionOrder ?? []).map((id, index) => [id, index]));
    const configured = [...(definition.directionConfiguration?.directionalRules ?? [])].sort((left, right) => left.priority - right.priority || (order.get(left.ruleId) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.ruleId) ?? Number.MAX_SAFE_INTEGER) || left.ruleId.localeCompare(right.ruleId));
    const evaluations: DirectionalRuleEvaluation[] = [];
    for (const rule of configured) {
      const result = strategy.ruleResults.find((item) => item.ruleId === rule.ruleId);
      const metadata = definition.ruleMetadata[rule.ruleId];
      if (!result || !metadata) return { evaluations, error: `Directional rule ${rule.ruleId} is absent from compiled strategy results.` };
      const contribution = confidence.contributions.find((item) => item.ruleId === rule.ruleId);
      const config = definition.ruleConfiguration?.[rule.ruleId];
      evaluations.push({ ruleId: rule.ruleId, ruleVersion: metadata.version, ruleName: metadata.name, executionOrder: order.get(rule.ruleId) ?? -1, priority: rule.priority, required: rule.required, sourceEvaluationStatus: result.status, sourceMatched: result.matched, supportsBuy: conditionMatches(rule.buyWhen, result), supportsSell: conditionMatches(rule.sellWhen, result), configuredBuyCondition: structuredClone(rule.buyWhen), configuredSellCondition: structuredClone(rule.sellWhen), timeframeRole: typeof config?.timeframeRole === 'string' ? config.timeframeRole : null, concreteTimeframe: typeof config?.timeframe === 'string' ? config.timeframe : null, evidenceNodeIds: [...(contribution?.evidenceNodeIds ?? [])], explanation: result.explanation, warnings: [...result.warnings] });
    }
    return { evaluations };
  }

  private inputError({ definition, strategy, graph, confidence, readiness, decision, policy }: Sources): string | null {
    const policyValidation = new DirectionPolicyValidator().validate(policy);
    if (!policyValidation.valid) return `Invalid direction policy: ${policyValidation.issues.map((issue) => issue.message).join(' ')}`;
    const sameStrategy = definition.id === strategy.strategyId && graph.strategyId === definition.id && confidence.strategyId === definition.id && readiness.strategyId === definition.id && decision.strategyId === definition.id;
    const sameVersions = definition.version === strategy.strategyVersion && graph.strategyVersion === definition.version && confidence.strategyVersion === definition.version && readiness.strategyVersion === definition.version && decision.strategyVersion === definition.version;
    const sameCompiled = confidence.compiledStrategyId === definition.compiledStrategyId && readiness.compiledStrategyId === definition.compiledStrategyId && decision.compiledStrategyId === definition.compiledStrategyId;
    const sameStrategyContext = graph.strategyContextId === strategy.contextId && confidence.strategyContextId === strategy.contextId && readiness.strategyContextId === strategy.contextId && decision.strategyContextId === strategy.contextId;
    const sameGraph = confidence.evidenceGraphId === graph.graphId && readiness.evidenceGraphId === graph.graphId && decision.evidenceGraphId === graph.graphId;
    const sameConfidence = readiness.confidenceAssessmentId === confidence.assessmentId && decision.confidenceAssessmentId === confidence.assessmentId;
    const sameMarket = strategy.marketContextId === graph.marketContextId && confidence.sourceMarketContextId === graph.marketContextId && readiness.sourceMarketContextId === graph.marketContextId && decision.marketContextId === graph.marketContextId;
    const sameReadiness = decision.readinessAssessmentId === readiness.assessmentId;
    const sameTime = graph.generatedAt === strategy.executionTimestamp && confidence.generatedAt === strategy.executionTimestamp && readiness.generatedAt === strategy.executionTimestamp && decision.generatedAt === strategy.executionTimestamp;
    return sameStrategy && sameVersions && sameCompiled && sameStrategyContext && sameGraph && sameConfidence && sameMarket && sameReadiness && sameTime ? null : 'Source identity mismatch.';
  }

  private build(sources: Sources, resolution: Resolution): DirectionAssessment {
    const { definition, strategy, graph, confidence, readiness, decision, policy } = sources;
    const evaluations = resolution.evaluations;
    const buy = unique(evaluations.filter((item) => item.supportsBuy).map((item) => item.ruleId));
    const sell = unique(evaluations.filter((item) => item.supportsSell).map((item) => item.ruleId));
    const conflicted = buy.length && sell.length ? unique([...buy, ...sell]) : [];
    const unavailable = evaluations.filter((item) => item.sourceEvaluationStatus === 'NOT_EVALUATED').map((item) => item.ruleId);
    const errors = evaluations.filter((item) => item.sourceEvaluationStatus === 'ERROR').map((item) => item.ruleId);
    const requiredUnavailable = evaluations.filter((item) => item.required && item.sourceEvaluationStatus === 'NOT_EVALUATED').map((item) => item.ruleId);
    const requiredFailed = evaluations.filter((item) => item.required && item.sourceEvaluationStatus === 'FAILED').map((item) => item.ruleId);
    const evidence = (ids: string[]): string[] => unique(evaluations.filter((item) => ids.includes(item.ruleId)).flatMap((item) => item.evidenceNodeIds));
    const config = definition.directionConfiguration;
    const values: Record<DirectionCriterionId, Omit<DirectionCriterionResult, 'criterionId' | 'name' | 'order'>> = {
      'upstream-validity': this.criterion(resolution.inputValid ? 'PASSED' : 'ERROR', resolution.inputValid, true, 'VALID', resolution.inputValid ? 'All upstream identities are consistent.' : 'Upstream validation failed.'),
      'decision-permission': this.criterion(resolution.decisionPermitted ? 'PASSED' : 'FAILED', decision.outcome, policy.requireActionableDecision ? 'ACTIONABLE' : policy.allowedDecisionOutcomes, 'IN', resolution.decisionPermitted ? 'Decision permits direction analysis.' : 'Decision does not permit direction analysis.'),
      'direction-configuration': this.criterion(config ? 'PASSED' : 'NOT_EVALUATED', Boolean(config), true, 'VALID', config ? 'Direction configuration is present.' : 'Direction configuration is absent.'),
      'direction-mode': this.criterion(resolution.modeAllowed ? 'PASSED' : config ? 'FAILED' : 'NOT_EVALUATED', config?.mode ?? null, ['FIXED', 'RULE_DERIVED', 'DUAL_SCENARIO'], 'ALLOWED', resolution.modeAllowed ? 'Direction mode is allowed.' : 'Direction mode was not evaluated or allowed.'),
      'directional-rules': this.criterion(config?.mode === 'FIXED' || evaluations.length ? 'PASSED' : 'NOT_EVALUATED', evaluations.length, config?.mode === 'FIXED' ? 0 : 1, '>=', 'Configured directional rules were inspected only through composition results.', evaluations.map((item) => item.ruleId), evidence(evaluations.map((item) => item.ruleId))),
      'required-directional-rules': this.criterion(requiredUnavailable.length || (policy.blockOnRequiredDirectionalRuleFailure && requiredFailed.length) ? 'FAILED' : evaluations.length ? 'PASSED' : 'NOT_EVALUATED', [...requiredUnavailable, ...requiredFailed], [], 'NONE', 'Required directional rule availability evaluated.', [...requiredUnavailable, ...requiredFailed], evidence([...requiredUnavailable, ...requiredFailed])),
      'directional-rule-errors': this.criterion(errors.length && policy.blockOnDirectionalRuleError ? 'ERROR' : evaluations.length ? 'PASSED' : 'NOT_EVALUATED', errors, [], 'NONE', errors.length ? 'Directional rule errors were found.' : 'No directional rule errors were found.', errors, evidence(errors)),
      'minimum-support': this.criterion(Math.max(buy.length, sell.length) >= policy.minimumDirectionalSupportCount ? 'PASSED' : evaluations.length ? 'FAILED' : 'NOT_EVALUATED', Math.max(buy.length, sell.length), policy.minimumDirectionalSupportCount, '>=', 'Directional support count compared with policy minimum.', unique([...buy, ...sell]), evidence(unique([...buy, ...sell]))),
      'buy-support': this.criterion(buy.length ? 'PASSED' : evaluations.length ? 'FAILED' : 'NOT_EVALUATED', buy.length, 1, '>=', buy.length ? 'Explicit BUY support exists.' : 'No explicit BUY support exists.', buy, evidence(buy)),
      'sell-support': this.criterion(sell.length ? 'PASSED' : evaluations.length ? 'FAILED' : 'NOT_EVALUATED', sell.length, 1, '>=', sell.length ? 'Explicit SELL support exists.' : 'No explicit SELL support exists.', sell, evidence(sell)),
      'conflict-resolution': this.criterion(conflicted.length ? (resolution.outcome === 'ERROR' ? 'ERROR' : resolution.outcome === 'CONFLICTED' ? 'FAILED' : 'PASSED') : evaluations.length ? 'PASSED' : 'NOT_EVALUATED', conflicted.length ? resolution.outcome : 'NO_CONFLICT', config?.conflictBehavior ?? policy.conflictBehavior, 'ALLOWED', conflicted.length ? `Both directions are supported; ${resolution.outcome} applied.` : 'No directional conflict exists.', conflicted, evidence(conflicted)),
    };
    const criteria = policy.criteriaOrder.map((id, order) => ({ criterionId: id, name: NAMES[id], order, ...values[id] }));
    return deepFreeze({ assessmentId: createDirectionAssessmentId(definition, strategy, graph, confidence, readiness, decision, policy), version: '1.0.0', engineVersion: DIRECTION_ENGINE_VERSION, policyId: policy.id, policyVersion: policy.version, strategyId: definition.id, strategyVersion: definition.version, compiledStrategyId: definition.compiledStrategyId, marketContextId: graph.marketContextId, strategyContextId: strategy.contextId, evidenceGraphId: graph.graphId, confidenceAssessmentId: confidence.assessmentId, readinessAssessmentId: readiness.assessmentId, decisionAssessmentId: decision.assessmentId, generatedAt: strategy.executionTimestamp, directionMode: config?.mode ?? null, status: resolution.status, outcome: resolution.outcome, direction: resolution.direction, directionalRuleEvaluations: evaluations, buySupportingRuleIds: buy, sellSupportingRuleIds: sell, conflictedRuleIds: conflicted, unavailableDirectionalRuleIds: unavailable, errorDirectionalRuleIds: errors, criteria, summary: { totalDirectionalRules: evaluations.length, buySupportCount: buy.length, sellSupportCount: sell.length, conflictedRules: conflicted.length, unavailableRules: unavailable.length, errorRules: errors.length, diagnostic: policy.metadata.diagnostic === true }, warnings: resolution.warnings });
  }

  private criterion(status: DirectionCriterionResult['status'], actualValue: DirectionCriterionResult['actualValue'], expectedValue: DirectionCriterionResult['expectedValue'], comparisonOperator: DirectionCriterionResult['comparisonOperator'], explanation: string, relatedRuleIds: string[] = [], relatedEvidenceNodeIds: string[] = []): Omit<DirectionCriterionResult, 'criterionId' | 'name' | 'order'> {
    const passed = status === 'PASSED';
    return { status, severity: status === 'ERROR' ? 'BLOCKING' : status === 'FAILED' ? 'WARNING' : 'INFO', actualValue, expectedValue, comparisonOperator, passed, explanation, relatedRuleIds, relatedEvidenceNodeIds, warnings: [] };
  }
}
