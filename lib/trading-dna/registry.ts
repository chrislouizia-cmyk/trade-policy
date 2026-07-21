import {
  TRADING_DNA_CATEGORY_IDS,
  type TradingDnaCategory,
  type TradingDnaCategoryId,
  type TradingDnaEvidenceType,
  type TradingDnaEvaluationType,
  type TradingDnaInput,
  type TradingDnaOperator,
  type TradingDnaRuleDefinition,
  type TradingDnaValidationIssue,
} from './types.ts';
import { getTradingDnaOperator, isTradingDnaOperator } from './operators.ts';

export const TRADING_DNA_CATEGORIES: readonly TradingDnaCategory[] = [
  { id: 'TREND', displayName: 'Trend', description: 'Directional context and trend-following indicators.', order: 1 },
  { id: 'MOMENTUM', displayName: 'Momentum', description: 'Strength, acceleration, and overbought or oversold conditions.', order: 2 },
  { id: 'MARKET_STRUCTURE', displayName: 'Market Structure', description: 'The sequence and breaks of price swing structure.', order: 3 },
  { id: 'SMART_MONEY', displayName: 'Smart Money Concepts', description: 'Liquidity, institutional zones, and displacement concepts.', order: 4 },
  { id: 'PRICE_ACTION', displayName: 'Price Action', description: 'Candles, ranges, breakouts, and reactions at meaningful levels.', order: 5 },
  { id: 'VOLUME', displayName: 'Volume', description: 'Participation, imbalance, and volume-price confirmation.', order: 6 },
  { id: 'SESSION', displayName: 'Session', description: 'Trading windows and session-specific constraints.', order: 7 },
  { id: 'RISK', displayName: 'Risk', description: 'Trade and account-level risk boundaries.', order: 8 },
  { id: 'EXTERNAL', displayName: 'External', description: 'Evidence supplied by calendars, correlated markets, or outside systems.', order: 9 },
] as const;

type SeedInput=Pick<TradingDnaInput,'key'|'label'|'type'|'required'>&Partial<Pick<TradingDnaInput,'unit'|'validation'|'default'|'allowedValues'>>;
type Seed = [id:string, name:string, category:TradingDnaCategoryId, subcategory:string, evidence:TradingDnaEvidenceType, evaluation:TradingDnaEvaluationType, operators:TradingDnaOperator[], inputs?:SeedInput[], tags?:string[]];
const TIMEFRAMES=['M1','M3','M5','M15','M30','H1','H2','H4','H6','H8','H12','D1','W1','MN'];
const tf: SeedInput = { key: 'timeframe', label: 'Timeframe', type: 'TIMEFRAME', required: true, default:'H1', allowedValues:TIMEFRAMES };
const period: SeedInput = { key: 'period', label: 'Period', type: 'PERIOD', required: true, default:14, validation:{min:1,max:500,integer:true} };
const bool: TradingDnaOperator[] = ['IS_TRUE', 'IS_FALSE'];
const compare: TradingDnaOperator[] = ['GREATER_THAN', 'LESS_THAN', 'GREATER_THAN_OR_EQUAL', 'LESS_THAN_OR_EQUAL', 'CROSSES_ABOVE', 'CROSSES_BELOW'];

const seeds: Seed[] = [
  ['trend.ema','EMA','TREND','Moving Average','INDICATOR','AUTOMATIC',compare,[tf,period],['exponential moving average','direction','crossover']],
  ['trend.sma','SMA','TREND','Moving Average','INDICATOR','AUTOMATIC',compare,[tf,period],['simple moving average','direction','crossover']],
  ['trend.vwap','VWAP','TREND','Fair Value','INDICATOR','AUTOMATIC',compare,[tf],['volume weighted average price','institutional benchmark']],
  ['trend.supertrend','Supertrend','TREND','Trend Indicator','INDICATOR','AUTOMATIC',bool,[tf,{key:'multiplier',label:'ATR multiplier',type:'NUMBER',required:true}],['atr','direction']],
  ['trend.ma-ribbon','Moving Average Ribbon','TREND','Moving Average','INDICATOR','AUTOMATIC',bool,[tf,{key:'periods',label:'Moving-average periods',type:'TEXT',required:true}],['ema ribbon','sma ribbon','alignment']],
  ['momentum.rsi','RSI','MOMENTUM','Oscillator','INDICATOR','AUTOMATIC',['GREATER_THAN','LESS_THAN','BETWEEN'],[tf,period,{key:'threshold',label:'Threshold',type:'NUMBER',required:true}],['relative strength index','overbought','oversold']],
  ['momentum.macd','MACD','MOMENTUM','Oscillator','INDICATOR','AUTOMATIC',['CROSSES_ABOVE','CROSSES_BELOW','GREATER_THAN','LESS_THAN'],[tf],['moving average convergence divergence','signal line','histogram']],
  ['momentum.adx','ADX','MOMENTUM','Trend Strength','INDICATOR','AUTOMATIC',compare,[tf,period,{key:'threshold',label:'Strength threshold',type:'NUMBER',required:true}],['average directional index','strength']],
  ['momentum.stochastic','Stochastic','MOMENTUM','Oscillator','INDICATOR','AUTOMATIC',['CROSSES_ABOVE','CROSSES_BELOW','GREATER_THAN','LESS_THAN'],[tf,period],['overbought','oversold','percent k']],
  ['momentum.cci','CCI','MOMENTUM','Oscillator','INDICATOR','AUTOMATIC',['GREATER_THAN','LESS_THAN','BETWEEN'],[tf,period],['commodity channel index','momentum']],
  ...['BOS','CHoCH','MSS','Higher High','Higher Low','Lower High','Lower Low','Trend Alignment'].map((name,index):Seed=>[`structure.${['bos','choch','mss','higher-high','higher-low','lower-high','lower-low','trend-alignment'][index]}`,name,'MARKET_STRUCTURE',index<3?'Structure Shift':'Swing Structure','PRICE_STRUCTURE','AUTOMATIC',bool,[tf],[name.toLowerCase(),'structure','swing']]),
  ...['Order Block','Breaker Block','Mitigation Block','Fair Value Gap','Liquidity Sweep','Equal High','Equal Low','Premium','Discount','Kill Zone'].map((name,index):Seed=>[`smart-money.${['order-block','breaker-block','mitigation-block','fair-value-gap','liquidity-sweep','equal-high','equal-low','premium','discount','kill-zone'][index]}`,name,'SMART_MONEY',index===9?'Timing':'Liquidity & Imbalance',index===9?'TIME_WINDOW':'PRICE_STRUCTURE',index===9?'MANUAL':'AUTOMATIC',bool,index===9?[{key:'window',label:'Kill-zone window',type:'SESSION',required:true}]:[tf],[name.toLowerCase(),'smc',index===9?'session':'liquidity']]),
  ...['Strong Rejection','Engulfing','Pin Bar','Inside Bar','Outside Bar','Breakout','Retest','Consolidation'].map((name,index):Seed=>[`price-action.${['strong-rejection','engulfing','pin-bar','inside-bar','outside-bar','breakout','retest','consolidation'][index]}`,name,'PRICE_ACTION',index<5?'Candle Pattern':'Range & Level','CANDLE_PATTERN','AUTOMATIC',bool,[tf],[name.toLowerCase(),'candle','price action']]),
  ...['Volume Spike','Above Average Volume','Delta Confirmation','Volume Divergence'].map((name,index):Seed=>[`volume.${['spike','above-average','delta-confirmation','divergence'][index]}`,name,'VOLUME',index<2?'Relative Volume':'Order Flow','VOLUME_DATA','AUTOMATIC',index<2?compare:bool,[tf,index<2?{key:'threshold',label:'Volume threshold',type:'NUMBER',required:true}:{key:'lookback',label:'Lookback',type:'PERIOD',required:true}],[name.toLowerCase(),'participation','volume']]),
  ...['London','New York','Asia','Session Overlap','Kill Zones'].map((name,index):Seed=>[`session.${['london','new-york','asia','overlap','kill-zones'][index]}`,name,'SESSION','Trading Window','TIME_WINDOW','AUTOMATIC',['WITHIN','OUTSIDE'],[{key:'window',label:'Trading window',type:'SESSION',required:true}],['session',name.toLowerCase(),'time window']]),
  ['risk.minimum-rr','Minimum RR','RISK','Reward to Risk','RISK_METRIC','AUTOMATIC',['GREATER_THAN_OR_EQUAL'],[{key:'ratio',label:'Minimum reward/risk',type:'NUMBER',required:true}],['risk reward','rr','r multiple']],
  ['risk.maximum-risk','Maximum Risk','RISK','Position Risk','RISK_METRIC','AUTOMATIC',['LESS_THAN_OR_EQUAL'],[{key:'percent',label:'Maximum risk',type:'PERCENT',required:true}],['position size','capital','percent risk']],
  ['risk.stop-placement','Stop Placement','RISK','Invalidation','RISK_METRIC','MANUAL',bool,[tf],['stop loss','invalidation','structure']],
  ['risk.maximum-daily-exposure','Maximum Daily Exposure','RISK','Account Exposure','RISK_METRIC','AUTOMATIC',['LESS_THAN_OR_EQUAL'],[{key:'percent',label:'Maximum daily exposure',type:'PERCENT',required:true}],['daily loss','portfolio risk','exposure']],
  ...['High Impact News','Correlation','Economic Calendar','Volatility Event'].map((name,index):Seed=>[`external.${['high-impact-news','correlation','economic-calendar','volatility-event'][index]}`,name,'EXTERNAL',index===1?'Intermarket':'Events','EXTERNAL_DATA','EXTERNAL',bool,[],[name.toLowerCase(),'external',index===1?'intermarket':'calendar']]),
];

const categoryName = new Map(TRADING_DNA_CATEGORIES.map(category => [category.id, category.displayName]));
const roles: Record<TradingDnaCategoryId, TradingDnaRuleDefinition['defaultTimeframeRole']> = { TREND:'TREND', MOMENTUM:'CONFIRMATION', MARKET_STRUCTURE:'CONFIRMATION', SMART_MONEY:'ENTRY', PRICE_ACTION:'TRIGGER', VOLUME:'TRIGGER', SESSION:'ENTRY', RISK:'ENTRY', EXTERNAL:'ENTRY' };

const aliases:Record<string,string[]>={
  'trend.ema':['Exponential Moving Average'], 'trend.sma':['Simple Moving Average'], 'trend.vwap':['Volume Weighted Average Price'],
  'structure.bos':['Break of Structure'], 'structure.choch':['Change of Character'], 'structure.mss':['Market Structure Shift'],
  'smart-money.order-block':['OB','Orderblock'], 'smart-money.fair-value-gap':['FVG','Imbalance'],
  'smart-money.liquidity-sweep':['Liquidity Grab','Stop Hunt'], 'smart-money.equal-high':['EQH'], 'smart-money.equal-low':['EQL'],
  'price-action.strong-rejection':['Rejection Candle'], 'risk.minimum-rr':['Risk Reward','Reward to Risk','R:R'],
  'external.high-impact-news':['Red Folder News'],
};
const complementary:Record<string,string[]>={
  'trend.ema':['structure.trend-alignment'], 'smart-money.order-block':['smart-money.fair-value-gap'],
  'smart-money.fair-value-gap':['smart-money.order-block'], 'structure.bos':['structure.choch'],
  'structure.choch':['structure.bos'], 'price-action.strong-rejection':['volume.spike'],
  'volume.spike':['price-action.strong-rejection'], 'smart-money.liquidity-sweep':['price-action.strong-rejection'],
};
const incompatible:Record<string,string[]>={
  'structure.higher-high':['structure.lower-low'], 'structure.lower-low':['structure.higher-high'],
  'structure.higher-low':['structure.lower-high'], 'structure.lower-high':['structure.higher-low'],
  'smart-money.premium':['smart-money.discount'], 'smart-money.discount':['smart-money.premium'],
  'session.london':['session.asia'], 'session.asia':['session.london'],
};
const inputOverrides:Record<string,SeedInput[]>={
  'trend.ema':[period,{key:'source',label:'Price source',type:'SELECT',required:true,default:'close',allowedValues:['open','high','low','close','hl2','hlc3']},tf],
  'trend.sma':[period,{key:'source',label:'Price source',type:'SELECT',required:true,default:'close',allowedValues:['open','high','low','close','hl2','hlc3']},tf],
  'momentum.rsi':[period,{key:'threshold',label:'Threshold',type:'NUMBER',required:true,default:50,validation:{min:0,max:100}},tf],
  'structure.bos':[{key:'direction',label:'Direction',type:'SELECT',required:true,default:'EITHER',allowedValues:['BULLISH','BEARISH','EITHER']},tf],
  'smart-money.fair-value-gap':[{key:'mitigationRequired',label:'Mitigation required',type:'BOOLEAN',required:true,default:true,allowedValues:[true,false]},tf],
  'risk.minimum-rr':[{key:'minimumRR',label:'Minimum Risk/Reward',type:'NUMBER',required:true,default:2,validation:{min:0.1,max:100},unit:':1'}],
};

function enrichInput(input:SeedInput):TradingDnaInput{
  const validation=input.validation??(input.type==='PERCENT'?{min:0,max:100}:input.type==='NUMBER'?{min:0}:{});
  const allowedValues=input.allowedValues??[];
  const fallback=input.type==='BOOLEAN'?false:input.type==='LIST'?[]:input.type==='NUMBER'||input.type==='PERCENT'||input.type==='PERIOD'?0:'';
  return {...input,validation,allowedValues,default:input.default??fallback};
}

function materialize([id,displayName,category,subcategory,evidenceType,evaluationType,supportedOperators,requiredInputs=[],tags=[]]:Seed):TradingDnaRuleDefinition {
  const source = evaluationType === 'AUTOMATIC' ? 'market data' : evaluationType === 'MANUAL' ? 'the trader’s confirmation' : 'an external integration';
  const resolvedOperators:TradingDnaOperator[]=evaluationType==='MANUAL'?['CONFIRMED','FAILED']:evaluationType==='EXTERNAL'?['EXISTS','MISSING']:supportedOperators;
  const sessionInputs:SeedInput[]=[{key:'session',label:'Session',type:'SESSION',required:true,default:displayName,allowedValues:['London','New York','Asia','Session Overlap','Kill Zones']}];
  const configuredInputs=inputOverrides[id]??(category==='SESSION'?sessionInputs:requiredInputs);
  const configurableInputs=configuredInputs.map(enrichInput);
  const relatedRules=[...(complementary[id]??[]),...(incompatible[id]??[])];
  const documentation={
    whatItMeasures:`Whether ${displayName} satisfies the configured ${subcategory.toLowerCase()} condition.`,
    whyTradersUseIt:`Traders use ${displayName} to make the entry requirement explicit and repeatable.`,
    typicalConfirmationSequence:[`Configure ${displayName}`,`Evaluate it from ${source}`,'Accept the condition only when its operator succeeds'],
    commonMistakes:['Using the condition without a defined context','Treating one confirmation as a guarantee of outcome'],
    relatedRules,
  };
  return {
    id, displayName, shortName:displayName, category, subcategory, evidenceType, evaluationType, supportedOperators:resolvedOperators,
    supportedTimeframes:evidenceType==='EXTERNAL_DATA'?[]:[...TIMEFRAMES],
    configurable: configurableInputs.length > 0, requiredInputs:configurableInputs, configurableInputs,
    defaultValues:Object.fromEntries(configurableInputs.map(input=>[input.key,input.default])),
    validationSchema:{type:'OBJECT',additionalProperties:false,required:configurableInputs.filter(input=>input.required).map(input=>input.key),properties:Object.fromEntries(configurableInputs.map(input=>[input.key,{type:input.type,validation:input.validation,allowedValues:input.allowedValues}]))},
    exampleConditions:[{operator:resolvedOperators[0],inputs:Object.fromEntries(configurableInputs.map(input=>[input.key,input.default])),description:`${displayName} satisfies its configured entry condition.`}],
    incompatibleRules:incompatible[id]??[],complementaryRules:complementary[id]??[],aliases:aliases[id]??[],
    tags: [...tags, categoryName.get(category) ?? category], documentation,
    educationalNotes:[`Confirm ${displayName} in the context defined by the playbook.`,'This rule describes evidence, not a probability of profit.'],
    description: `Checks whether ${displayName} provides the evidence required by the playbook.`,
    typicalUsage: `Use ${displayName} as a ${subcategory.toLowerCase()} confirmation before entry.`,
    whatItMeans: `${displayName} is a ${categoryName.get(category)?.toLowerCase()} condition evaluated from ${source}.`,
    whyTradersUseIt: documentation.whyTradersUseIt,
    typicalConfirmations: [`The configured ${displayName} condition is present`, 'The condition is evaluated on the selected timeframe or context'],
    exampleScenario: `${displayName} matches its configured condition before the proposed entry.`,
    validationRequirements: [`Receive ${configurableInputs.filter(input=>input.required).map(input=>input.label).join(', ') || 'the required evidence state'}`, `Evaluate with ${resolvedOperators.join(' or ')}`],
    defaultTimeframeRole: roles[category],
  };
}

export const TRADING_DNA_RULES: readonly TradingDnaRuleDefinition[] = seeds.map(materialize);

export function getTradingDnaRulesByCategory(category:TradingDnaCategoryId) {
  return TRADING_DNA_RULES.filter(rule => rule.category === category);
}

export function searchTradingDnaRules(query:string, category?:TradingDnaCategoryId) {
  const terms=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return TRADING_DNA_RULES.map((rule,index) => {
    if(category && rule.category!==category)return null;
    const fields=[
      [rule.displayName,100],[rule.shortName,95],[rule.aliases.join(' '),90],[rule.tags.join(' '),70],
      [rule.description,55],[Object.values(rule.documentation).flat().join(' '),45],
      [categoryName.get(rule.category)??rule.category,35],[rule.subcategory,30],
    ] as const;
    if(!terms.length)return {rule,score:0,index};
    const score=terms.reduce((total,term)=>total+Math.max(0,...fields.map(([value,weight])=>value.toLocaleLowerCase().includes(term)?weight:0)),0);
    return terms.every(term=>fields.some(([value])=>value.toLocaleLowerCase().includes(term)))?{rule,score,index}:null;
  }).filter((item):item is {rule:TradingDnaRuleDefinition;score:number;index:number}=>Boolean(item)).sort((a,b)=>b.score-a.score||a.index-b.index).map(item=>item.rule);
}

export function validateTradingDnaRuleInputs(rule:TradingDnaRuleDefinition,values:Record<string,unknown>):TradingDnaValidationIssue[]{
  const issues:TradingDnaValidationIssue[]=[];
  for(const key of Object.keys(values))if(!rule.validationSchema.properties[key])issues.push({id:rule.id,field:key,message:'Unknown input'});
  for(const input of rule.configurableInputs){
    const value=values[input.key];
    if(input.required&&(value===undefined||value===null||value==='')){issues.push({id:rule.id,field:input.key,message:'Required input is missing'});continue;}
    if(value===undefined)continue;
    if(input.allowedValues.length&&!input.allowedValues.includes(value as never))issues.push({id:rule.id,field:input.key,message:'Value is not allowed'});
    if(typeof value==='number'){
      if(input.validation.min!==undefined&&value<input.validation.min)issues.push({id:rule.id,field:input.key,message:`Value must be at least ${input.validation.min}`});
      if(input.validation.max!==undefined&&value>input.validation.max)issues.push({id:rule.id,field:input.key,message:`Value must be at most ${input.validation.max}`});
      if(input.validation.integer&&!Number.isInteger(value))issues.push({id:rule.id,field:input.key,message:'Value must be an integer'});
    }
  }
  return issues;
}

export function validateTradingDnaCondition(rule:TradingDnaRuleDefinition,operator:TradingDnaOperator,values:Record<string,unknown>):TradingDnaValidationIssue[]{
  const issues=validateTradingDnaRuleInputs(rule,values);
  if(!rule.supportedOperators.includes(operator))issues.unshift({id:rule.id,field:'operator',message:`${operator} is not supported by ${rule.displayName}`});
  else if(!getTradingDnaOperator(operator))issues.unshift({id:rule.id,field:'operator',message:'Unknown operator'});
  return issues;
}

export function getOperatorsForTradingDnaRule(rule:TradingDnaRuleDefinition){
  return rule.supportedOperators.map(getTradingDnaOperator).filter((operator):operator is NonNullable<typeof operator>=>Boolean(operator));
}

export function validateTradingDnaRegistry(rules:readonly TradingDnaRuleDefinition[]=TRADING_DNA_RULES):TradingDnaValidationIssue[] {
  const issues:TradingDnaValidationIssue[]=[];
  const seen=new Set<string>();
  const evidenceTypes=new Set(['INDICATOR','PRICE_STRUCTURE','CANDLE_PATTERN','VOLUME_DATA','TIME_WINDOW','RISK_METRIC','EXTERNAL_DATA']);
  for(const rule of rules){
    if(seen.has(rule.id))issues.push({id:rule.id,field:'id',message:'Duplicate rule id'}); seen.add(rule.id);
    for(const field of ['id','displayName','shortName','description','category','subcategory','evidenceType','evaluationType','typicalUsage','whatItMeans','whyTradersUseIt','exampleScenario'] as const){if(!rule[field])issues.push({id:rule.id||'(missing)',field,message:'Required metadata is missing'});}
    if(!TRADING_DNA_CATEGORY_IDS.includes(rule.category))issues.push({id:rule.id,field:'category',message:'Unknown category'});
    if(!evidenceTypes.has(rule.evidenceType))issues.push({id:rule.id,field:'evidenceType',message:'Unknown evidence type'});
    if(!rule.supportedOperators.length)issues.push({id:rule.id,field:'supportedOperators',message:'At least one operator is required'});
    for(const operator of rule.supportedOperators)if(!isTradingDnaOperator(operator))issues.push({id:rule.id,field:'supportedOperators',message:`Unknown operator: ${operator}`});
    for(const input of rule.configurableInputs)if(!(input.key&&input.label&&input.type&&input.validation&&input.allowedValues&&input.default!==undefined))issues.push({id:rule.id,field:'configurableInputs',message:'Input metadata is incomplete'});
    if(JSON.stringify(rule.defaultValues)!==JSON.stringify(Object.fromEntries(rule.configurableInputs.map(input=>[input.key,input.default]))))issues.push({id:rule.id,field:'defaultValues',message:'Defaults do not match configurable inputs'});
    for(const relationship of [...rule.incompatibleRules,...rule.complementaryRules])if(!rules.some(candidate=>candidate.id===relationship))issues.push({id:rule.id,field:'relationships',message:`Unknown related rule: ${relationship}`});
    if(!rule.tags.length)issues.push({id:rule.id,field:'tags',message:'At least one tag is required'});
    if(!rule.typicalConfirmations.length||!rule.validationRequirements.length||!rule.documentation.whatItMeasures||!rule.documentation.typicalConfirmationSequence.length||!rule.documentation.commonMistakes.length||!rule.educationalNotes.length)issues.push({id:rule.id,field:'documentation',message:'Rule documentation is incomplete'});
  }
  return issues;
}
