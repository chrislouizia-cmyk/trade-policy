import type { EvidenceGraph } from '../evidence-graph/evidence-graph-types.ts';
import { EvidenceGraphValidator } from '../evidence-graph/evidence-graph-validator.ts';
import { stableFingerprint } from '../serialization/stable-fingerprint.ts';
import type { StrategyContext } from '../strategy-composition/composition-types.ts';
import type { CompiledStrategyDefinition, MissingEvidenceBehavior } from '../strategy-definitions/strategy-definition-types.ts';
import type { ConfidenceAssessment, ConfidenceContribution, ConfidenceEngineConfig, ConfidenceStatus } from './confidence-types.ts';

export const DEFAULT_CONFIDENCE_ENGINE_CONFIG: ConfidenceEngineConfig = Object.freeze({ engineVersion: '1.0.0', errorTreatment: 'PARTIAL' });
const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];
function deepFreeze<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; }
export function normalizeConfidenceEngineConfig(config: ConfidenceEngineConfig): ConfidenceEngineConfig { return { engineVersion: config.engineVersion, ...(config.decimalDisplayPrecision === undefined ? {} : { decimalDisplayPrecision: config.decimalDisplayPrecision }), errorTreatment: config.errorTreatment }; }
function display(value: number | null, precision: number | undefined): string | null { return value === null ? null : precision === undefined ? String(value) : value.toFixed(precision); }
function graphNodesForRule(graph: EvidenceGraph, ruleId: string): string[] {
  const roots = graph.nodes.filter((node) => node.type === 'RULE_EVALUATION' && node.data.ruleId === ruleId).map((node) => node.id), found = new Set(roots), queue = [...roots];
  while (queue.length) { const current = queue.shift()!; for (const item of graph.edges.filter((candidate) => candidate.from === current && (candidate.type === 'REFERENCES_OBSERVATION' || candidate.type === 'CONTAINS_EVIDENCE'))) if (!found.has(item.to)) { found.add(item.to); queue.push(item.to); } }
  return [...found];
}
export function createConfidenceAssessmentId(definition: CompiledStrategyDefinition, context: StrategyContext, graph: EvidenceGraph, config: ConfidenceEngineConfig): string {
  return `confidence:${stableFingerprint({ compiledStrategyId: definition.compiledStrategyId, strategyContextId: context.contextId, evidenceGraphId: graph.graphId, requestedAt: context.executionTimestamp, engineVersion: config.engineVersion, config: normalizeConfidenceEngineConfig(config) })}`;
}

export class ConfidenceEngine {
  readonly #config: ConfidenceEngineConfig;
  constructor(config: ConfidenceEngineConfig = DEFAULT_CONFIDENCE_ENGINE_CONFIG) {
    if (!config.engineVersion.trim() || !['PARTIAL', 'ERROR'].includes(config.errorTreatment) || (config.decimalDisplayPrecision !== undefined && (!Number.isInteger(config.decimalDisplayPrecision) || config.decimalDisplayPrecision < 0 || config.decimalDisplayPrecision > 12))) throw new Error('Invalid ConfidenceEngineConfig.');
    this.#config = Object.freeze(normalizeConfidenceEngineConfig(config));
  }

  assess(definition: CompiledStrategyDefinition, context: StrategyContext, graph: EvidenceGraph): ConfidenceAssessment {
    const failure = this.inputError(definition, context, graph);
    if (failure) return this.errorAssessment(definition, context, graph, failure);
    const warnings = [...context.warnings, ...graph.warnings], contributions: ConfidenceContribution[] = [];
    for (const result of context.ruleResults) {
      const configuration = definition.ruleConfiguration![result.ruleId], configuredWeight = configuration.confidenceContribution as number;
      const missingEvidenceBehavior = definition.ruleMissingEvidenceBehaviors?.[result.ruleId] ?? 'NOT_EVALUATED';
      let eligibleWeight = configuredWeight, earnedWeight = result.status === 'MATCHED' ? configuredWeight : 0;
      if (result.status === 'NOT_EVALUATED' && missingEvidenceBehavior !== 'FAIL') eligibleWeight = 0;
      if (result.status === 'NOT_EVALUATED' && missingEvidenceBehavior === 'NOT_EVALUATED') warnings.push(`Rule ${result.ruleId} was excluded from eligible weight because evidence was unavailable.`);
      const evidenceNodeIds = graphNodesForRule(graph, result.ruleId);
      if (result.evidenceReferences.length && !evidenceNodeIds.some((id) => graph.nodes.find((node) => node.id === id)?.type === 'DETECTOR_OBSERVATION')) warnings.push(`Evidence graph has no resolved detector observation for rule ${result.ruleId}.`);
      contributions.push({ ruleId: result.ruleId, ruleVersion: definition.ruleMetadata[result.ruleId].version, ruleName: definition.ruleMetadata[result.ruleId].name, requirement: definition.ruleRequirements?.[result.ruleId] ?? 'OPTIONAL', evaluationStatus: result.status, matched: result.matched, configuredWeight, eligibleWeight, earnedWeight, missingEvidenceBehavior, timeframeRole: typeof configuration.timeframeRole === 'string' ? configuration.timeframeRole : null, concreteTimeframe: typeof configuration.timeframe === 'string' ? configuration.timeframe : null, evidenceNodeIds, explanation: result.explanation, warnings: [...result.warnings] });
    }
    const configuredWeight = contributions.reduce((total, item) => total + item.configuredWeight, 0), eligibleWeight = contributions.reduce((total, item) => total + item.eligibleWeight, 0), rawEarnedWeight = contributions.reduce((total, item) => total + item.earnedWeight, 0);
    const confidenceRatio = eligibleWeight > 0 ? rawEarnedWeight / eligibleWeight : null, confidencePercent = confidenceRatio === null ? null : confidenceRatio * 100;
    const configuredCoverageRatio = configuredWeight > 0 ? eligibleWeight / configuredWeight : null, configuredCoveragePercent = configuredCoverageRatio === null ? null : configuredCoverageRatio * 100;
    const failed = contributions.filter((item) => item.evaluationStatus === 'FAILED'), unavailable = contributions.filter((item) => item.evaluationStatus === 'NOT_EVALUATED'), errors = contributions.filter((item) => item.evaluationStatus === 'ERROR');
    const status: ConfidenceStatus = errors.length && this.#config.errorTreatment === 'ERROR' ? 'ERROR' : eligibleWeight === 0 ? 'UNAVAILABLE' : errors.length || unavailable.some((item) => item.missingEvidenceBehavior === 'NOT_EVALUATED') ? 'PARTIAL' : 'CALCULATED';
    return deepFreeze({ assessmentId: createConfidenceAssessmentId(definition, context, graph, this.#config), version: '1.0.0', engineVersion: this.#config.engineVersion, strategyId: definition.id, strategyVersion: definition.version, compiledStrategyId: definition.compiledStrategyId, strategyContextId: context.contextId, evidenceGraphId: graph.graphId, sourceMarketContextId: graph.marketContextId, generatedAt: context.executionTimestamp, status, confidenceRatio, confidencePercent, configuredCoverageRatio, configuredCoveragePercent, rawEarnedWeight, eligibleWeight, configuredWeight, contributions, failedRequiredRuleIds: failed.filter((item) => item.requirement === 'REQUIRED').map((item) => item.ruleId), failedOptionalRuleIds: failed.filter((item) => item.requirement === 'OPTIONAL').map((item) => item.ruleId), unavailableRequiredRuleIds: unavailable.filter((item) => item.requirement === 'REQUIRED').map((item) => item.ruleId), unavailableOptionalRuleIds: unavailable.filter((item) => item.requirement === 'OPTIONAL').map((item) => item.ruleId), errorRuleIds: errors.map((item) => item.ruleId), warnings: unique(warnings), summary: { totalRules: contributions.length, matchedRules: contributions.filter((item) => item.matched).length, failedRules: failed.length, unavailableRules: unavailable.length, errorRules: errors.length, confidenceDisplay: display(confidencePercent, this.#config.decimalDisplayPrecision), configuredCoverageDisplay: display(configuredCoveragePercent, this.#config.decimalDisplayPrecision), meaning: 'EVIDENCE_MATCH_RATIO_NOT_PROBABILITY' } });
  }

  private inputError(definition: CompiledStrategyDefinition, context: StrategyContext, graph: EvidenceGraph): string | null {
    if (definition.id !== context.strategyId || definition.version !== context.strategyVersion) return 'Compiled strategy definition does not match StrategyContext identity.';
    if (graph.strategyId !== definition.id || graph.strategyVersion !== definition.version || graph.strategyContextId !== context.contextId || graph.marketContextId !== context.marketContextId || graph.generatedAt !== context.executionTimestamp) return 'EvidenceGraph source identity does not match confidence inputs.';
    if (!new EvidenceGraphValidator().validate(graph).valid) return 'EvidenceGraph is invalid.';
    const ids = definition.ruleExecutionOrder ?? [], resultIds = context.ruleResults.map((item) => item.ruleId);
    if (ids.length !== resultIds.length || ids.some((id, index) => id !== resultIds[index])) return 'StrategyContext rule results do not match compiled rule execution order.';
    for (const id of ids) { const weight = definition.ruleConfiguration?.[id]?.confidenceContribution; if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0) return `Rule ${id} has an invalid configured confidence contribution.`; if (!definition.ruleMetadata?.[id]) return `Rule ${id} has no compiled metadata.`; }
    return null;
  }

  private errorAssessment(definition: CompiledStrategyDefinition, context: StrategyContext, graph: EvidenceGraph, warning: string): ConfidenceAssessment {
    return deepFreeze({ assessmentId: createConfidenceAssessmentId(definition, context, graph, this.#config), version: '1.0.0', engineVersion: this.#config.engineVersion, strategyId: definition.id, strategyVersion: definition.version, compiledStrategyId: definition.compiledStrategyId, strategyContextId: context.contextId, evidenceGraphId: graph.graphId, sourceMarketContextId: graph.marketContextId, generatedAt: context.executionTimestamp, status: 'ERROR', confidenceRatio: null, confidencePercent: null, configuredCoverageRatio: null, configuredCoveragePercent: null, rawEarnedWeight: 0, eligibleWeight: 0, configuredWeight: 0, contributions: [], failedRequiredRuleIds: [], failedOptionalRuleIds: [], unavailableRequiredRuleIds: [], unavailableOptionalRuleIds: [], errorRuleIds: [], warnings: [warning], summary: { totalRules: 0, matchedRules: 0, failedRules: 0, unavailableRules: 0, errorRules: 0, confidenceDisplay: null, configuredCoverageDisplay: null, meaning: 'EVIDENCE_MATCH_RATIO_NOT_PROBABILITY' } });
  }
}
