import type { EvidenceKey, StrategyRule } from '../types/trade.ts';
const evidenceKeys: EvidenceKey[] = ['h4TrendAligned','h1TrendAligned','structurePattern','liquiditySweep','chochConfirmed','bosConfirmed','orderBlock','fairValueGap','retestConfirmed'];
const evidenceAliases: Readonly<Record<string, EvidenceKey>> = Object.freeze({
  h4trendaligned:'h4TrendAligned',
  h1trendaligned:'h1TrendAligned',
  trendalignment:'h1TrendAligned',
  trendalignmenth1:'h1TrendAligned',
  trendalignmenth4:'h4TrendAligned',
  htftrendalignment:'h4TrendAligned',
  structurepattern:'structurePattern',
  supportresistance:'structurePattern',
  marketstructure:'structurePattern',
  liquiditysweep:'liquiditySweep',
  liquiditygrab:'liquiditySweep',
  choch:'chochConfirmed',
  chochconfirmed:'chochConfirmed',
  bos:'bosConfirmed',
  bosconfirmed:'bosConfirmed',
  breakofstructure:'bosConfirmed',
  breakofstructureconfirmed:'bosConfirmed',
  breakoutclose:'bosConfirmed',
  closebeyondlevel:'bosConfirmed',
  orderblock:'orderBlock',
  fairvaluegap:'fairValueGap',
  fvg:'fairValueGap',
  retest:'retestConfirmed',
  retestconfirmed:'retestConfirmed',
});

const dnaAliases: Readonly<Record<string, string>> = Object.freeze({
  h4trendaligned:'structure.trend-alignment',
  h1trendaligned:'structure.trend-alignment',
  trendalignment:'structure.trend-alignment',
  trendalignmenth1:'structure.trend-alignment',
  trendalignmenth4:'structure.trend-alignment',
  structurepattern:'structure.higher-high',
  liquiditysweep:'smart-money.liquidity-sweep',
  displacement:'smart-money.displacement',
  smartmoneydisplacement:'smart-money.displacement',
  choch:'structure.choch',
  chochconfirmed:'structure.choch',
  bos:'structure.bos',
  bosconfirmed:'structure.bos',
  breakofstructure:'structure.bos',
  breakofstructureconfirmed:'structure.bos',
  orderblock:'smart-money.order-block',
  fairvaluegap:'smart-money.fair-value-gap',
  fvg:'smart-money.fair-value-gap',
  premiumdiscount:'smart-money.discount',
  premiumdiscounted:'smart-money.discount',
  premiumdiscounts:'smart-money.discount',
  retest:'price-action.retest',
  retestconfirmed:'price-action.retest',
  rejectioncandle:'price-action.strong-rejection',
  volumeconfirmation:'volume.above-average',
  sessionrequirement:'session.london',
  newsfilter:'external.high-impact-news',
  correlationfilter:'external.correlation',
});

export function normalizeStrategyRuleToken(ruleKey:string){return ruleKey.trim().toLowerCase().replace(/[^a-z0-9]+/g,'');}
export function normalizeActiveStrategyEvidenceKey(ruleKey:string):EvidenceKey|null{
  if(evidenceKeys.includes(ruleKey as EvidenceKey))return ruleKey as EvidenceKey;
  return evidenceAliases[normalizeStrategyRuleToken(ruleKey)]??null;
}
export function resolveActiveStrategyDnaRuleId(ruleKey:string):string|null{return dnaAliases[normalizeStrategyRuleToken(ruleKey)]??null;}
export function reconstructActiveEvidenceConfiguration(rules:readonly StrategyRule[],profileWeights:Record<string,unknown>|null|undefined){const evidenceWeights:Record<string,number>={},requiredEvidence:EvidenceKey[]=[];for(const rule of rules){if(!rule.enabled)continue;const key=normalizeActiveStrategyEvidenceKey(rule.ruleKey);const evaluationMode=String(rule.evaluationMode??'').toUpperCase();if(!key||evaluationMode==='DESCRIPTIVE'||!['AUTOMATIC','MANUAL','EXTERNAL'].includes(evaluationMode)||!Number.isFinite(rule.weight)||rule.weight<=0)continue;evidenceWeights[key]=Number(rule.weight);if(rule.mandatory)requiredEvidence.push(key);}if(!Object.keys(evidenceWeights).length){for(const [key,value] of Object.entries(profileWeights??{})){const normalized=normalizeActiveStrategyEvidenceKey(key);const numeric=Number(value);if(normalized&&Number.isFinite(numeric)&&numeric>0)evidenceWeights[normalized]=numeric;}}return{evidenceWeights,requiredEvidence:[...new Set(requiredEvidence)]};}
