import type { ReadinessCriterionId, ReadinessPolicy, ReadinessValidationIssue, ReadinessValidationResult } from './readiness-types.ts';

export const READINESS_CRITERIA: readonly ReadinessCriterionId[] = Object.freeze(['confidence-threshold','coverage-threshold','required-rules','required-rule-failure','required-rule-unavailable','rule-errors','partial-confidence','minimum-matched-rules','maximum-optional-failures']);
const SEMVER=/^\d+\.\d+\.\d+$/,ID=/^[a-z][a-z0-9-]*$/;
export class ReadinessPolicyValidator {
  validate(policy: ReadinessPolicy): ReadinessValidationResult {
    const issues:ReadinessValidationIssue[]=[],add=(code:string,path:string,message:string)=>issues.push({code,path,message});
    if(!ID.test(policy.id))add('INVALID_POLICY_ID','id','Policy id must be lowercase kebab-case.');
    if(!SEMVER.test(policy.version))add('INVALID_POLICY_VERSION','version','Policy version must use semantic versioning.');
    if(!policy.name.trim())add('MISSING_POLICY_NAME','name','Policy name is required.');
    if(!policy.description.trim())add('MISSING_POLICY_DESCRIPTION','description','Policy description is required.');
    for(const [path,value] of [['minimumConfidencePercent',policy.minimumConfidencePercent],['minimumCoveragePercent',policy.minimumCoveragePercent]] as const)if(!Number.isFinite(value)||value<0||value>100)add('INVALID_THRESHOLD',path,`${path} must be between 0 and 100 inclusive.`);
    for(const key of ['requireAllRequiredRulesMatched','blockOnRequiredRuleFailure','blockOnRequiredRuleUnavailable','blockOnAnyRuleError','allowPartialConfidence'] as const)if(typeof policy[key]!=='boolean')add('INVALID_BOOLEAN',key,`${key} must be boolean.`);
    for(const key of ['minimumMatchedRuleCount','maximumFailedOptionalRules'] as const){const value=policy[key];if(value!==undefined&&(!Number.isInteger(value)||value<0))add('INVALID_COUNT',key,`${key} must be a non-negative integer.`);}
    if(policy.metadata.schemaVersion!=='1.0.0')add('UNSUPPORTED_POLICY_SCHEMA','metadata.schemaVersion','Only readiness policy schema 1.0.0 is supported.');
    const seen=new Set<string>();policy.criteriaOrder.forEach((id,index)=>{if(seen.has(id))add('DUPLICATE_CRITERION_ORDER',`criteriaOrder[${index}]`,`Criterion occurs more than once: ${id}`);seen.add(id);if(!READINESS_CRITERIA.includes(id))add('UNKNOWN_CRITERION',`criteriaOrder[${index}]`,`Unsupported readiness criterion: ${id}`);});
    for(const required of READINESS_CRITERIA)if(!seen.has(required))add('MISSING_CRITERION','criteriaOrder',`Required criterion is missing: ${required}`);
    return{valid:issues.length===0,issues};
  }
}
