import type { CompositionRuleRegistry } from '../strategy-composition/composition-rule-registry.ts';
import type { DeclarativeStrategyDefinition, StrategyDefinitionValidationIssue, StrategyDefinitionValidationResult } from './strategy-definition-types.ts';

const SEMVER = /^\d+\.\d+\.\d+$/;
const KEY = /^[a-z][a-z0-9-]*$/;
const add = (issues: StrategyDefinitionValidationIssue[], code: string, path: string, message: string): void => { issues.push({ code, path, message }); };

export class StrategyDefinitionValidator {
  readonly #registry: CompositionRuleRegistry;
  constructor(registry: CompositionRuleRegistry) { this.#registry = registry; }

  validate(definition: DeclarativeStrategyDefinition): StrategyDefinitionValidationResult {
    const issues: StrategyDefinitionValidationIssue[] = [];
    if (!definition.id?.trim() || !KEY.test(definition.id)) add(issues, 'INVALID_ID', 'id', 'Strategy id must be a lowercase kebab-case identifier.');
    if (!definition.name?.trim()) add(issues, 'MISSING_NAME', 'name', 'Strategy name is required.');
    if (!SEMVER.test(definition.version)) add(issues, 'INVALID_VERSION', 'version', 'Strategy version must use semantic versioning.');
    if (!['SCALPING', 'INTRADAY', 'SWING', 'POSITION', 'CUSTOM'].includes(definition.tradingStyle)) add(issues, 'INVALID_TRADING_STYLE', 'tradingStyle', 'Trading style is invalid.');
    if (!definition.supportedSymbols.length && !definition.supportedAssetClasses.length) add(issues, 'MISSING_MARKET_SCOPE', 'supportedSymbols', 'At least one supported symbol or asset class is required.');
    const roles = Object.entries(definition.timeframeRoles);
    for (const [role, timeframe] of roles) {
      if (!KEY.test(role)) add(issues, 'INVALID_TIMEFRAME_ROLE', `timeframeRoles.${role}`, 'Timeframe role must be a lowercase kebab-case identifier.');
      if (!timeframe.trim()) add(issues, 'MISSING_TIMEFRAME', `timeframeRoles.${role}`, 'Timeframe value is required.');
    }
    const seenRules = new Set<string>(), seenOrders = new Set<number>();
    definition.rules.forEach((rule, index) => {
      const path = `rules[${index}]`;
      if (seenRules.has(rule.ruleId)) add(issues, 'DUPLICATE_RULE', `${path}.ruleId`, `Rule ${rule.ruleId} is configured more than once.`); else seenRules.add(rule.ruleId);
      if (!this.#registry.get(rule.ruleId)) add(issues, 'UNKNOWN_RULE', `${path}.ruleId`, `Composition rule is not registered: ${rule.ruleId}`);
      if (rule.requirement !== 'REQUIRED' && rule.requirement !== 'OPTIONAL') add(issues, 'INVALID_REQUIREMENT', `${path}.requirement`, 'Rule requirement must be REQUIRED or OPTIONAL.');
      if (rule.missingEvidenceBehavior && !['NOT_EVALUATED', 'FAIL', 'IGNORE'].includes(rule.missingEvidenceBehavior)) add(issues, 'INVALID_MISSING_EVIDENCE_BEHAVIOR', `${path}.missingEvidenceBehavior`, 'Missing-evidence behavior must be NOT_EVALUATED, FAIL, or IGNORE.');
      if (!Number.isFinite(rule.confidenceContribution) || rule.confidenceContribution < 0) add(issues, 'INVALID_CONFIDENCE_CONTRIBUTION', `${path}.confidenceContribution`, 'Confidence contribution must be a finite non-negative number.');
      if (!Number.isInteger(rule.executionOrder) || rule.executionOrder < 0) add(issues, 'INVALID_EXECUTION_ORDER', `${path}.executionOrder`, 'Execution order must be a non-negative integer.');
      else if (seenOrders.has(rule.executionOrder)) add(issues, 'DUPLICATE_EXECUTION_ORDER', `${path}.executionOrder`, `Execution order ${rule.executionOrder} is already used.`); else seenOrders.add(rule.executionOrder);
      if (rule.timeframeRole && !(rule.timeframeRole in definition.timeframeRoles)) add(issues, 'UNKNOWN_TIMEFRAME_ROLE', `${path}.timeframeRole`, `Timeframe role is not defined: ${rule.timeframeRole}`);
      if (!rule.parameters || Array.isArray(rule.parameters) || typeof rule.parameters !== 'object') add(issues, 'INVALID_PARAMETERS', `${path}.parameters`, 'Rule parameters must be a JSON object.');
    });
    if (definition.validation.schemaVersion !== '1.0.0') add(issues, 'UNSUPPORTED_SCHEMA_VERSION', 'validation.schemaVersion', 'Only strategy definition schema 1.0.0 is supported.');
    if (!definition.validation.description?.trim()) add(issues, 'MISSING_DESCRIPTION', 'validation.description', 'Validation description is required.');
    const direction=definition.directionConfiguration;
    if(direction){
      if(!['FIXED','RULE_DERIVED','DUAL_SCENARIO'].includes(direction.mode))add(issues,'INVALID_DIRECTION_MODE','directionConfiguration.mode','Direction mode is invalid.');
      if(!['CONFLICTED','NO_DIRECTION','ERROR'].includes(direction.conflictBehavior))add(issues,'INVALID_DIRECTION_CONFLICT','directionConfiguration.conflictBehavior','Conflict behavior is invalid.');
      if(direction.mode==='FIXED'&&!direction.fixedDirection)add(issues,'MISSING_FIXED_DIRECTION','directionConfiguration.fixedDirection','FIXED mode requires BUY or SELL.');
      if(direction.fixedDirection!==undefined&&!['BUY','SELL'].includes(direction.fixedDirection))add(issues,'INVALID_FIXED_DIRECTION','directionConfiguration.fixedDirection','Fixed direction must be BUY or SELL.');
      if(direction.mode!=='FIXED'&&direction.fixedDirection!==undefined)add(issues,'FIXED_DIRECTION_NOT_ALLOWED','directionConfiguration.fixedDirection',`${direction.mode} must not configure fixedDirection.`);
      if(direction.mode==='FIXED'&&direction.directionalRules?.length)add(issues,'FIXED_RULES_NOT_ALLOWED','directionConfiguration.directionalRules','FIXED mode cannot configure directional rules.');
      if(direction.mode!=='FIXED'&&!direction.directionalRules?.length)add(issues,'MISSING_DIRECTIONAL_RULES','directionConfiguration.directionalRules',`${direction.mode} requires directional rules.`);
      const enabled=new Set(definition.rules.filter(rule=>rule.enabled).map(rule=>rule.ruleId)),seen=new Set<string>();
      direction.directionalRules?.forEach((rule,index)=>{const path=`directionConfiguration.directionalRules[${index}]`;if(seen.has(rule.ruleId))add(issues,'DUPLICATE_DIRECTIONAL_RULE',`${path}.ruleId`,`Duplicate directional rule: ${rule.ruleId}`);seen.add(rule.ruleId);if(!enabled.has(rule.ruleId))add(issues,'UNKNOWN_OR_DISABLED_DIRECTIONAL_RULE',`${path}.ruleId`,`Directional rule must reference an enabled rule: ${rule.ruleId}`);if(!Number.isInteger(rule.priority)||rule.priority<0)add(issues,'INVALID_DIRECTIONAL_PRIORITY',`${path}.priority`,'Priority must be a non-negative integer.');if(typeof rule.required!=='boolean')add(issues,'INVALID_DIRECTIONAL_REQUIRED',`${path}.required`,'Required must be boolean.');for(const [key,condition]of[['buyWhen',rule.buyWhen],['sellWhen',rule.sellWhen]]as const){if(!condition||typeof condition!=='object'||Array.isArray(condition))add(issues,'INVALID_DIRECTION_CONDITION',`${path}.${key}`,'Direction condition must be a declarative object.');else if(condition.type==='RULE_STATUS'&&!['MATCHED','FAILED','NOT_EVALUATED','ERROR'].includes(condition.status))add(issues,'INVALID_DIRECTION_CONDITION',`${path}.${key}`,'Unsupported rule status condition.');else if(condition.type==='RULE_MATCH'&&typeof condition.matched!=='boolean')add(issues,'INVALID_DIRECTION_CONDITION',`${path}.${key}`,'RULE_MATCH requires a boolean.');else if(condition.type!=='RULE_STATUS'&&condition.type!=='RULE_MATCH')add(issues,'INVALID_DIRECTION_CONDITION',`${path}.${key}`,'Unsupported direction condition.');}if(JSON.stringify(rule.buyWhen)===JSON.stringify(rule.sellWhen))add(issues,'IDENTICAL_DIRECTION_CONDITIONS',path,'BUY and SELL conditions cannot be identical.');});
    }
    return { valid: issues.length === 0, issues };
  }
}
