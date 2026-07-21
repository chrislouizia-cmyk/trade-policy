import type { TradingDnaOperator, TradingDnaOperatorDefinition } from './types.ts';

const numeric=['NUMBER','PERIOD','PERCENT'] as const;
const scalar=['NUMBER','PERIOD','PERCENT','TEXT','SELECT','TIMEFRAME','SESSION'] as const;
export const TRADING_DNA_OPERATORS:readonly TradingDnaOperatorDefinition[]=[
  {id:'GREATER_THAN',label:'Greater Than',symbol:'>',group:'COMPARISON',operandCount:1,supportedInputTypes:numeric},
  {id:'LESS_THAN',label:'Less Than',symbol:'<',group:'COMPARISON',operandCount:1,supportedInputTypes:numeric},
  {id:'GREATER_THAN_OR_EQUAL',label:'Greater Than or Equal',symbol:'>=',group:'COMPARISON',operandCount:1,supportedInputTypes:numeric},
  {id:'LESS_THAN_OR_EQUAL',label:'Less Than or Equal',symbol:'<=',group:'COMPARISON',operandCount:1,supportedInputTypes:numeric},
  {id:'EQUALS',label:'Equals',symbol:'=',group:'COMPARISON',operandCount:1,supportedInputTypes:scalar},
  {id:'NOT_EQUALS',label:'Does Not Equal',symbol:'!=',group:'COMPARISON',operandCount:1,supportedInputTypes:scalar},
  {id:'IS_TRUE',label:'True',group:'BOOLEAN',operandCount:0,supportedInputTypes:['BOOLEAN']},
  {id:'IS_FALSE',label:'False',group:'BOOLEAN',operandCount:0,supportedInputTypes:['BOOLEAN']},
  {id:'CROSSES_ABOVE',label:'Cross Above',group:'CROSSOVER',operandCount:1,supportedInputTypes:numeric},
  {id:'CROSSES_BELOW',label:'Cross Below',group:'CROSSOVER',operandCount:1,supportedInputTypes:numeric},
  {id:'EXISTS',label:'Exists',group:'STATE',operandCount:0,supportedInputTypes:['BOOLEAN','TEXT','SELECT']},
  {id:'MISSING',label:'Missing',group:'STATE',operandCount:0,supportedInputTypes:['BOOLEAN','TEXT','SELECT']},
  {id:'CONFIRMED',label:'Confirmed',group:'STATE',operandCount:0,supportedInputTypes:['BOOLEAN']},
  {id:'FAILED',label:'Failed',group:'STATE',operandCount:0,supportedInputTypes:['BOOLEAN']},
  {id:'BETWEEN',label:'Between',group:'RANGE',operandCount:2,supportedInputTypes:numeric},
  {id:'OUTSIDE',label:'Outside',group:'RANGE',operandCount:2,supportedInputTypes:numeric},
  {id:'WITHIN',label:'Within',group:'RANGE',operandCount:2,supportedInputTypes:['SESSION','NUMBER','PERIOD']},
  {id:'CONTAINS',label:'Contains',group:'LIST',operandCount:1,supportedInputTypes:['LIST','TEXT']},
  {id:'EXCLUDES',label:'Excludes',group:'LIST',operandCount:1,supportedInputTypes:['LIST','TEXT']},
] as const;

const byId=new Map(TRADING_DNA_OPERATORS.map(operator=>[operator.id,operator]));
export function getTradingDnaOperator(id:TradingDnaOperator){return byId.get(id);}
export function isTradingDnaOperator(value:string):value is TradingDnaOperator{return byId.has(value as TradingDnaOperator);}
