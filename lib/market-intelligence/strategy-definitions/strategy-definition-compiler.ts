import type { JsonObject, JsonValue } from '../contracts.ts';
import type { CompositionRuleRegistry } from '../strategy-composition/composition-rule-registry.ts';
import type { CompiledStrategyDefinition, DeclarativeStrategyDefinition, StrategyDefinitionValidationIssue } from './strategy-definition-types.ts';
import { StrategyDefinitionValidator } from './strategy-definition-validator.ts';
import { stableFingerprint } from '../serialization/stable-fingerprint.ts';

export class StrategyDefinitionCompilationError extends Error {
  readonly issues: StrategyDefinitionValidationIssue[];
  constructor(issues: StrategyDefinitionValidationIssue[]) { super(`Strategy definition is invalid: ${issues.map((issue) => issue.message).join(' ')}`); this.name = 'StrategyDefinitionCompilationError'; this.issues = issues; }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}

export class StrategyDefinitionCompiler {
  readonly #validator: StrategyDefinitionValidator;
  readonly #registry: CompositionRuleRegistry;
  constructor(registry: CompositionRuleRegistry) { this.#registry = registry; this.#validator = new StrategyDefinitionValidator(registry); }

  compile(definition: DeclarativeStrategyDefinition): CompiledStrategyDefinition {
    const validation = this.#validator.validate(definition);
    if (!validation.valid) throw new StrategyDefinitionCompilationError(validation.issues);
    const enabled = definition.rules.filter((rule) => rule.enabled).sort((left, right) => left.executionOrder - right.executionOrder);
    const ruleConfiguration: Record<string, JsonObject> = {}, ruleRequirements: Record<string, 'REQUIRED' | 'OPTIONAL'> = {}, ruleMissingEvidenceBehaviors: Record<string, 'NOT_EVALUATED' | 'FAIL' | 'IGNORE'> = {}, ruleMetadata: Record<string, { name: string; version: string }> = {};
    for (const rule of enabled) {
      const timeframe = rule.timeframeRole ? definition.timeframeRoles[rule.timeframeRole] : undefined;
      ruleConfiguration[rule.ruleId] = { ...structuredClone(rule.parameters), ...(rule.timeframeRole ? { timeframeRole: rule.timeframeRole } : {}), ...(timeframe ? { timeframe } : {}), confidenceContribution: rule.confidenceContribution as JsonValue };
      ruleRequirements[rule.ruleId] = rule.requirement;
      ruleMissingEvidenceBehaviors[rule.ruleId] = rule.missingEvidenceBehavior ?? 'NOT_EVALUATED';
      const registered = this.#registry.get(rule.ruleId)!;
      ruleMetadata[rule.ruleId] = { name: registered.metadata.name, version: registered.metadata.version };
    }
    const trend = ruleConfiguration['trend-alignment']?.requiredTrend;
    const compiled: CompiledStrategyDefinition = {
      id: definition.id, compiledStrategyId: `compiled-strategy:${stableFingerprint(definition)}`, name: definition.name, version: definition.version, sourceDefinitionVersion: definition.version,
      tradingStyle: definition.tradingStyle, supportedSymbols: [...definition.supportedSymbols], supportedAssetClasses: [...definition.supportedAssetClasses],
      timeframeRoles: { ...definition.timeframeRoles }, validation: structuredClone(definition.validation),
      ruleExecutionOrder: enabled.map((rule) => rule.ruleId), ruleConfiguration, ruleRequirements, ruleMissingEvidenceBehaviors, ruleMetadata,
      ...(trend === 'BULLISH' || trend === 'BEARISH' || trend === 'RANGE' ? { requiredTrend: trend } : {}),
      ...(definition.directionConfiguration ? { directionConfiguration: structuredClone(definition.directionConfiguration) } : {}),
    };
    return deepFreeze(compiled);
  }
}
