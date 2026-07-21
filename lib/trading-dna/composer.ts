import type { StrategyRule } from '@/types/trade';
import { TRADING_DNA_RULES, validateTradingDnaCondition } from './registry.ts';
import { getTradingDnaOperator } from './operators.ts';
import type { TradingDnaOperator, TradingDnaRuleDefinition, TradingDnaValidationIssue } from './types.ts';

export type ComposerLogic='ALL'|'ANY';
export type ComposerCondition={kind:'CONDITION';id:string;ruleId:string;operator:TradingDnaOperator;inputs:Record<string,string|number|boolean|string[]>;operands:(string|number|boolean)[];legacyRule?:StrategyRule};
export type ComposerGroup={kind:'GROUP';id:string;logic:ComposerLogic;children:(ComposerGroup|ComposerCondition)[]};
export type ComposerNode=ComposerGroup|ComposerCondition;

const PREFIX='dna.v1.';
const registryById=new Map(TRADING_DNA_RULES.map(rule=>[rule.id,rule]));
const legacyAliases:Record<string,string>={h4TrendAligned:'structure.trend-alignment',h1TrendAligned:'structure.trend-alignment',structurePattern:'structure.higher-high',liquiditySweep:'smart-money.liquidity-sweep',chochConfirmed:'structure.choch',bosConfirmed:'structure.bos',orderBlock:'smart-money.order-block',fairValueGap:'smart-money.fair-value-gap',premiumDiscount:'smart-money.discount',retestConfirmed:'price-action.retest',rejectionCandle:'price-action.strong-rejection',volumeConfirmation:'volume.above-average',sessionRequirement:'session.london',newsFilter:'external.high-impact-news',correlationFilter:'external.correlation'};

export function createComposerGroup(id='root',logic:ComposerLogic='ALL'):ComposerGroup{return {kind:'GROUP',id,logic,children:[]};}
export function createComposerCondition(rule:TradingDnaRuleDefinition,id:string):ComposerCondition{return {kind:'CONDITION',id,ruleId:rule.id,operator:rule.supportedOperators[0],inputs:{...rule.defaultValues},operands:[]};}

type Encoded={condition:Omit<ComposerCondition,'kind'|'legacyRule'>;path:{id:string;logic:ComposerLogic;index:number}[];rootLogic?:ComposerLogic};
function encode(value:Encoded){return PREFIX+encodeURIComponent(JSON.stringify(value));}
function decode(value:string):Encoded|null{if(!value.startsWith(PREFIX))return null;try{return JSON.parse(decodeURIComponent(value.slice(PREFIX.length))) as Encoded}catch{return null}}

export function composerTreeFromStrategyRules(rules:StrategyRule[]):ComposerGroup{
  const root=createComposerGroup();
  for(const [index,strategyRule] of rules.entries()){
    const stored=decode(strategyRule.ruleKey);
    if(stored){if(stored.rootLogic)root.logic=stored.rootLogic;insertPath(root,stored.path,{kind:'CONDITION',...stored.condition,legacyRule:strategyRule});continue;}
    const ruleId=registryById.has(strategyRule.ruleKey)?strategyRule.ruleKey:legacyAliases[strategyRule.ruleKey];
    const definition=ruleId?registryById.get(ruleId):undefined;
    const condition:ComposerCondition=definition?{...createComposerCondition(definition,`legacy-${index}`),legacyRule:strategyRule}:{kind:'CONDITION',id:`legacy-${index}`,ruleId:strategyRule.ruleKey,operator:'CONFIRMED',inputs:{},operands:[],legacyRule:strategyRule};
    root.children.push(condition);
  }
  return root;
}

function insertPath(root:ComposerGroup,path:Encoded['path'],condition:ComposerCondition){let group=root;for(const part of path.filter(item=>item.id!=='root')){let child=group.children.find(item=>item.kind==='GROUP'&&item.id===part.id) as ComposerGroup|undefined;if(!child){child=createComposerGroup(part.id,part.logic);group.children.splice(Math.min(part.index,group.children.length),0,child)}group=child}group.children.push(condition)}

export function strategyRulesFromComposerTree(root:ComposerGroup):StrategyRule[]{
  const result:StrategyRule[]=[];
  function visit(group:ComposerGroup,path:Encoded['path']){group.children.forEach((node,index)=>{if(node.kind==='GROUP'){visit(node,[...path,{id:node.id,logic:node.logic,index}]);return}const definition=registryById.get(node.ruleId);const base=node.legacyRule;if(base&&path.length===0&&root.logic==='ALL'){result.push({...base});return}result.push({ruleKey:encode({condition:{id:node.id,ruleId:node.ruleId,operator:node.operator,inputs:node.inputs,operands:node.operands},path,rootLogic:root.logic}),label:summarizeComposerCondition(node),enabled:base?.enabled??true,mandatory:base?.mandatory??true,weight:base?.weight??10,minimumConfidence:base?.minimumConfidence??60,timeframeRole:definition?.defaultTimeframeRole??base?.timeframeRole??'ENTRY',evaluationMode:definition?.evaluationType??base?.evaluationMode??'MANUAL'})})}visit(root,[]);return result;
}

export function validateComposerCondition(condition:ComposerCondition):TradingDnaValidationIssue[]{const rule=registryById.get(condition.ruleId);if(!rule)return condition.legacyRule?[]:[{id:condition.id,field:'ruleId',message:'Select a registry rule'}];const issues=validateTradingDnaCondition(rule,condition.operator,condition.inputs);const operator=getTradingDnaOperator(condition.operator);if(operator&&condition.operands.length<operator.operandCount)issues.push({id:condition.id,field:'operands',message:'Complete the operator value'});return issues}

export function validateComposerTree(root:ComposerGroup):TradingDnaValidationIssue[]{
  const issues:TradingDnaValidationIssue[]=[];
  function visit(group:ComposerGroup){const conditions=group.children.filter((node):node is ComposerCondition=>node.kind==='CONDITION');for(const condition of conditions)issues.push(...validateComposerCondition(condition));if(group.logic==='ALL'){for(let i=0;i<conditions.length;i++)for(let j=i+1;j<conditions.length;j++){const a=conditions[i],b=conditions[j],definition=registryById.get(a.ruleId);if(definition?.incompatibleRules.includes(b.ruleId)||a.ruleId===b.ruleId&&a.inputs.direction&&b.inputs.direction&&a.inputs.direction!==b.inputs.direction)issues.push({id:group.id,field:'children',message:`${summarizeComposerCondition(a)} conflicts with ${summarizeComposerCondition(b)} in the same ALL group`})}}for(const child of group.children)if(child.kind==='GROUP')visit(child)}visit(root);return issues;
}

const operatorPhrase:Partial<Record<TradingDnaOperator,string>>={GREATER_THAN:'is above',LESS_THAN:'is below',GREATER_THAN_OR_EQUAL:'is at least',LESS_THAN_OR_EQUAL:'is at most',EQUALS:'equals',NOT_EQUALS:'does not equal',CROSSES_ABOVE:'crosses above',CROSSES_BELOW:'crosses below',IS_TRUE:'is true',IS_FALSE:'is false',EXISTS:'exists',MISSING:'is missing',CONFIRMED:'is confirmed',FAILED:'failed',BETWEEN:'is between',OUTSIDE:'is outside',WITHIN:'is active',CONTAINS:'contains',EXCLUDES:'excludes'};
export function summarizeComposerCondition(condition:ComposerCondition){const rule=registryById.get(condition.ruleId);if(!rule)return condition.legacyRule?.label??condition.ruleId;const values=Object.entries(condition.inputs).filter(([,value])=>value!==''&&value!==undefined).map(([key,value])=>key==='timeframe'?String(value):key==='direction'?String(value).toLowerCase():String(value));const operands=condition.operands.map(String);return [rule.displayName,...values,operatorPhrase[condition.operator]??condition.operator.toLowerCase(),...operands].join(' ').replace(/\s+/g,' ').trim()}
export function summarizeComposerTree(root:ComposerGroup){const lines:string[]=[];function visit(group:ComposerGroup,depth:number){if(depth)lines.push(`${'  '.repeat(depth-1)}${group.logic==='ALL'?'All of':'Any of'}:`);for(const child of group.children)child.kind==='GROUP'?visit(child,depth+1):lines.push(`${'  '.repeat(depth)}• ${summarizeComposerCondition(child)}`)}visit(root,0);return lines}

export function updateComposerNode(root:ComposerGroup,id:string,updater:(node:ComposerNode)=>ComposerNode):ComposerGroup{function map(group:ComposerGroup):ComposerGroup{return {...group,children:group.children.map(node=>node.id===id?updater(node):node.kind==='GROUP'?map(node):node)}}return map(root)}
export function deleteComposerNode(root:ComposerGroup,id:string):ComposerGroup{function map(group:ComposerGroup):ComposerGroup{return {...group,children:group.children.filter(node=>node.id!==id).map(node=>node.kind==='GROUP'?map(node):node)}}return map(root)}
export function duplicateComposerNode(root:ComposerGroup,id:string,newId:string):ComposerGroup{function map(group:ComposerGroup):ComposerGroup{const children:ComposerNode[]=[];for(const node of group.children){children.push(node.kind==='GROUP'?map(node):node);if(node.id===id)children.push(node.kind==='GROUP'?{...node,id:newId,children:[...node.children]}:{...node,id:newId,inputs:{...node.inputs},operands:[...node.operands],legacyRule:undefined})}return {...group,children}}return map(root)}
export function moveComposerNode(root:ComposerGroup,id:string,direction:-1|1):ComposerGroup{function map(group:ComposerGroup):ComposerGroup{const index=group.children.findIndex(node=>node.id===id);if(index>=0){const target=index+direction;if(target<0||target>=group.children.length)return group;const children=[...group.children];[children[index],children[target]]=[children[target],children[index]];return {...group,children}}return {...group,children:group.children.map(node=>node.kind==='GROUP'?map(node):node)}}return map(root)}
export function appendComposerNode(root:ComposerGroup,groupId:string,node:ComposerNode):ComposerGroup{if(root.id===groupId)return {...root,children:[...root.children,node]};return {...root,children:root.children.map(child=>child.kind==='GROUP'?appendComposerNode(child,groupId,node):child)}}
