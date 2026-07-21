import type { ConfidenceAssessment } from '../confidence/confidence-types.ts';
import type { EvidenceGraph } from '../evidence-graph/evidence-graph-types.ts';
import type { StrategyContext } from '../strategy-composition/composition-types.ts';
import type { CompiledStrategyDefinition } from '../strategy-definitions/strategy-definition-types.ts';
import { createReadinessAssessmentId, ReadinessPolicyEngine } from './readiness-policy-engine.ts';
import type { ReadinessAssessment, ReadinessPolicy, ReadinessValidationIssue, ReadinessValidationResult } from './readiness-types.ts';

const forbidden=new Set(['buy','sell','direction','entry','entryPrice','stop','stopLoss','target','takeProfit','risk','positionSize','execution','executeTrade','payload']);
export class ReadinessAssessmentValidator{
  validate(assessment:ReadinessAssessment,definition:CompiledStrategyDefinition,context:StrategyContext,graph:EvidenceGraph,confidence:ConfidenceAssessment,policy:ReadinessPolicy):ReadinessValidationResult{
    const issues:ReadinessValidationIssue[]=[],add=(code:string,path:string,message:string)=>issues.push({code,path,message}),expected=new ReadinessPolicyEngine().assess(definition,context,graph,confidence,policy);
    if(assessment.strategyId!==definition.id||assessment.strategyVersion!==definition.version||assessment.compiledStrategyId!==definition.compiledStrategyId||assessment.strategyContextId!==context.contextId||assessment.evidenceGraphId!==graph.graphId||assessment.confidenceAssessmentId!==confidence.assessmentId||assessment.sourceMarketContextId!==graph.marketContextId||assessment.generatedAt!==context.executionTimestamp)add('SOURCE_IDENTITY_MISMATCH','identity','Readiness source identities are inconsistent.');
    if(assessment.assessmentId!==createReadinessAssessmentId(definition,context,graph,confidence,policy))add('ASSESSMENT_ID_MISMATCH','assessmentId','Readiness assessment ID is inconsistent.');
    const ids=assessment.criteria.map(item=>item.criterionId);if(new Set(ids).size!==ids.length)add('DUPLICATE_CRITERION','criteria','Criterion IDs must be unique.');if(JSON.stringify(ids)!==JSON.stringify(policy.criteriaOrder)||assessment.criteria.some((item,index)=>item.order!==index))add('CRITERION_ORDER_MISMATCH','criteria','Criterion order must match policy order.');
    const graphIds=new Set(graph.nodes.map(node=>node.id));assessment.criteria.forEach((item,index)=>item.relatedEvidenceNodeIds.forEach(id=>{if(!graphIds.has(id))add('MISSING_EVIDENCE_NODE',`criteria[${index}].relatedEvidenceNodeIds`,`Evidence node does not exist: ${id}`);}));
    const expectedById=new Map(expected.criteria.map(item=>[item.criterionId,item]));assessment.criteria.forEach((item,index)=>{const target=expectedById.get(item.criterionId);if(!target||item.status!==target.status||item.severity!==target.severity||item.passed!==target.passed||JSON.stringify(item.actualValue)!==JSON.stringify(target.actualValue)||JSON.stringify(item.expectedValue)!==JSON.stringify(target.expectedValue)||item.comparisonOperator!==target.comparisonOperator)add('CRITERION_RESULT_MISMATCH',`criteria[${index}]`,`Criterion result does not match policy evaluation.`);});
    for(const [key,code] of [['failedCriterionIds','FAILED_CRITERIA_MISMATCH'],['blockingCriterionIds','BLOCKING_CRITERIA_MISMATCH'],['warningCriterionIds','WARNING_CRITERIA_MISMATCH'],['failedRequiredRuleIds','REQUIRED_RULE_LIST_MISMATCH'],['unavailableRequiredRuleIds','REQUIRED_RULE_LIST_MISMATCH'],['errorRuleIds','ERROR_RULE_LIST_MISMATCH']] as const)if(JSON.stringify(assessment[key])!==JSON.stringify(expected[key]))add(code,key,`${key} does not match evaluated criteria.`);
    if(assessment.status!==expected.status)add('STATUS_PRECEDENCE_MISMATCH','status','Readiness status does not follow deterministic precedence.');
    if(assessment.matchedRuleCount!==expected.matchedRuleCount||assessment.failedRuleCount!==expected.failedRuleCount)add('RULE_TOTAL_MISMATCH','matchedRuleCount','Rule totals do not match StrategyContext.');
    if(JSON.stringify(assessment.summary)!==JSON.stringify(expected.summary))add('SUMMARY_MISMATCH','summary','Readiness summary totals are inconsistent.');
    const inspect=(value:unknown,path:string):void=>{if(typeof value==='number'&&!Number.isFinite(value))add('NON_FINITE_NUMBER',path,'Readiness assessment cannot contain NaN or Infinity.');if(Array.isArray(value))value.forEach((child,index)=>inspect(child,`${path}[${index}]`));else if(value&&typeof value==='object')Object.entries(value).forEach(([key,child])=>{if(forbidden.has(key))add('FORBIDDEN_FIELD',`${path}.${key}`,`Forbidden decision or execution field: ${key}`);inspect(child,`${path}.${key}`);});};inspect(assessment,'assessment');
    return{valid:issues.length===0,issues};
  }
}
