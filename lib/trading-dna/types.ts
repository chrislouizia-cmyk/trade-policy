import type { StrategyRule } from '@/types/trade';

export const TRADING_DNA_CATEGORY_IDS = [
  'TREND', 'MOMENTUM', 'MARKET_STRUCTURE', 'SMART_MONEY', 'PRICE_ACTION',
  'VOLUME', 'SESSION', 'RISK', 'EXTERNAL',
] as const;

export type TradingDnaCategoryId = typeof TRADING_DNA_CATEGORY_IDS[number];
export type TradingDnaEvidenceType =
  | 'INDICATOR' | 'PRICE_STRUCTURE' | 'CANDLE_PATTERN' | 'VOLUME_DATA'
  | 'TIME_WINDOW' | 'RISK_METRIC' | 'EXTERNAL_DATA';
export type TradingDnaEvaluationType = NonNullable<StrategyRule['evaluationMode']>;
export type TradingDnaOperator =
  | 'IS_TRUE' | 'IS_FALSE' | 'EQUALS' | 'NOT_EQUALS' | 'GREATER_THAN' | 'LESS_THAN'
  | 'GREATER_THAN_OR_EQUAL' | 'LESS_THAN_OR_EQUAL' | 'CROSSES_ABOVE'
  | 'CROSSES_BELOW' | 'EXISTS' | 'MISSING' | 'CONFIRMED' | 'FAILED'
  | 'BETWEEN' | 'WITHIN' | 'OUTSIDE' | 'CONTAINS' | 'EXCLUDES';

export type TradingDnaOperatorGroup = 'COMPARISON'|'BOOLEAN'|'CROSSOVER'|'STATE'|'RANGE'|'LIST';
export type TradingDnaOperatorDefinition = {
  id: TradingDnaOperator;
  label: string;
  symbol?: string;
  group: TradingDnaOperatorGroup;
  operandCount: 0|1|2;
  supportedInputTypes: readonly TradingDnaInputType[];
};

export type TradingDnaInputType = 'NUMBER'|'PERIOD'|'TIMEFRAME'|'SESSION'|'PERCENT'|'TEXT'|'SELECT'|'BOOLEAN'|'LIST';
export type TradingDnaInputValidation = { min?:number; max?:number; integer?:boolean; minLength?:number; maxLength?:number };

export type TradingDnaInput = {
  key: string;
  label: string;
  type: TradingDnaInputType;
  required: boolean;
  unit?: string;
  validation: TradingDnaInputValidation;
  default: string|number|boolean|string[];
  allowedValues: readonly (string|number|boolean)[];
};

export type TradingDnaValidationSchema = {
  type: 'OBJECT';
  additionalProperties: false;
  required: string[];
  properties: Record<string,{type:TradingDnaInputType;validation:TradingDnaInputValidation;allowedValues:readonly (string|number|boolean)[]}>;
};

export type TradingDnaExampleCondition = { operator:TradingDnaOperator; inputs:Record<string,string|number|boolean|string[]>; description:string };
export type TradingDnaDocumentation = { whatItMeasures:string; whyTradersUseIt:string; typicalConfirmationSequence:string[]; commonMistakes:string[]; relatedRules:string[] };

export type TradingDnaCategory = {
  id: TradingDnaCategoryId;
  displayName: string;
  description: string;
  order: number;
};

export type TradingDnaRuleDefinition = {
  id: string;
  displayName: string;
  shortName: string;
  description: string;
  category: TradingDnaCategoryId;
  subcategory: string;
  evidenceType: TradingDnaEvidenceType;
  evaluationType: TradingDnaEvaluationType;
  supportedOperators: TradingDnaOperator[];
  configurable: boolean;
  requiredInputs: TradingDnaInput[];
  supportedTimeframes: string[];
  configurableInputs: TradingDnaInput[];
  defaultValues: Record<string,string|number|boolean|string[]>;
  validationSchema: TradingDnaValidationSchema;
  exampleConditions: TradingDnaExampleCondition[];
  incompatibleRules: string[];
  complementaryRules: string[];
  aliases: string[];
  tags: string[];
  documentation: TradingDnaDocumentation;
  educationalNotes: string[];
  typicalUsage: string;
  whatItMeans: string;
  whyTradersUseIt: string;
  typicalConfirmations: string[];
  exampleScenario: string;
  validationRequirements: string[];
  defaultTimeframeRole: StrategyRule['timeframeRole'];
};

export type TradingDnaValidationIssue = { id: string; field: string; message: string };
