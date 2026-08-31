import { normalizeActiveStrategyEvidenceKey } from './active-strategy-evidence.ts';
import type { StrategyProfile, StrategyRule, StrategySession, TradingStyle } from '../types/trade.ts';

const marketNames:Record<string,string>={XAUUSD:'Gold',XAGUSD:'Silver'};
const styleNames:Record<TradingStyle,string>={scalping:'Scalper','day-trading':'Day Trader',swing:'Swing Trader',position:'Position Trader'};

function supportedRequiredRule(rule: StrategyRule): boolean {
  if (!rule.enabled || !rule.mandatory) return false;
  const key = normalizeActiveStrategyEvidenceKey(String(rule.ruleKey ?? ''));
  if (!key) return false;
  const evaluationMode = String(rule.evaluationMode ?? '').toUpperCase();
  if (evaluationMode === 'DESCRIPTIVE') return false;
  if (!['AUTOMATIC', 'MANUAL', 'EXTERNAL'].includes(evaluationMode)) return false;
  const weight = Number(rule.weight ?? 0);
  return Number.isFinite(weight) && weight > 0;
}

function supportedEnabledRule(rule: StrategyRule): boolean {
  if (!rule.enabled) return false;
  const key = normalizeActiveStrategyEvidenceKey(String(rule.ruleKey ?? ''));
  if (!key) return false;
  const evaluationMode = String(rule.evaluationMode ?? '').toUpperCase();
  if (evaluationMode === 'DESCRIPTIVE') return false;
  if (!['AUTOMATIC', 'MANUAL', 'EXTERNAL'].includes(evaluationMode)) return false;
  const weight = Number(rule.weight ?? 0);
  return Number.isFinite(weight) && weight > 0;
}

export type FinalReviewSummary={
  narrative:string[];
  totalRules:number;
  automaticRules:number;
  manualRules:number;
  externalRules:number;
  tradingStyle:string;
  instrumentLabel:string;
  sessionLabel:string;
  readiness:string;
  persistable:boolean;
  canSimulate:boolean;
  canSave:boolean;
  canActivate:boolean;
  supportedRuleCount:number;
  requiredRuleCount:number;
  optionalRuleCount:number;
  unsupportedRuleCount:number;
  manualOptionalRuleCount:number;
  statusDetail:string;
};

function list(values:string[]){return new Intl.ListFormat('en',{style:'long',type:'conjunction'}).format(values)}

export function buildFinalReviewSummary(profile:StrategyProfile,rules:StrategyRule[],sessions:StrategySession[]):FinalReviewSummary{
  const enabled=rules.filter(rule=>rule.enabled);
  const learned=enabled.length?enabled:rules;
  const automaticRules=learned.filter(rule=>(rule.evaluationMode??'AUTOMATIC')==='AUTOMATIC').length;
  const manualRules=learned.filter(rule=>rule.evaluationMode==='MANUAL').length;
  const externalRules=learned.filter(rule=>rule.evaluationMode==='EXTERNAL').length;
  const supportedEnabled=learned.filter(supportedEnabledRule);
  const requiredSupported=learned.filter(supportedRequiredRule);
  const optionalSupported=learned.filter(rule=>rule.enabled && !rule.mandatory && supportedEnabledRule(rule));
  const unsupportedEnabled=learned.filter(rule=>rule.enabled && !supportedEnabledRule(rule));
  const manualOptionalRules=learned.filter(rule=>rule.enabled && rule.evaluationMode==='MANUAL' && !rule.mandatory);
  const tradingStyle=styleNames[profile.tradingStyle??'day-trading'];
  const markets=list(profile.instruments.map(symbol=>marketNames[symbol]??symbol));
  const sessionNames=list(sessions.map(session=>session.name));
  const narrative=[
    `You trade ${markets} as a ${tradingStyle}.`,
    sessions.length?`You focus on the ${sessionNames} ${sessions.length===1?'session':'sessions'}.`:'You have not limited this playbook to a trading session.',
    `Every trade must meet a minimum Risk/Reward of ${profile.minimumRR}:1.`,
    `You risk ${profile.maximumRiskPercent}% of your capital per trade.`,
    `I will only approve trades that satisfy the required rules from your Trading DNA and reach your ${profile.authorizationScore}% minimum approval score.`,
  ];
  const persistable=learned.every(rule=>typeof rule.ruleKey==='string'&&Boolean(rule.ruleKey.trim())&&Boolean(rule.label.trim()))&&new Set(learned.map(rule=>rule.ruleKey.trim())).size===learned.length;
  const canSimulate = persistable && supportedEnabled.length > 0;
  const canSave = persistable && requiredSupported.length > 0;
  const canActivate = canSave;

  let readiness = 'Rules need review before saving';
  let statusDetail = 'This playbook still needs stable rule names before it can be evaluated.';

  if (persistable && !canSimulate) {
    readiness = 'No supported rule is enabled';
    statusDetail = unsupportedEnabled.length
      ? 'This condition is not supported yet and will not count toward activation.'
      : 'Add an enabled, supported rule to qualify for simulated validation.';
  } else if (persistable && canSimulate && !canSave) {
    readiness = 'Eligible for simulated validation only';
    statusDetail = manualOptionalRules.length
      ? 'The current enabled rule is manual and optional, so it cannot satisfy the required-rule contract for save or live activation.'
      : unsupportedEnabled.length
        ? 'This condition is not supported yet and will not count toward activation.'
        : 'Some enabled rules exist, but none are valid supported mandatory rules required for save or activation.';
  } else if (persistable && canSave) {
    readiness = profile.id ? 'Ready for live validation' : 'Ready for simulated validation';
    statusDetail = profile.id
      ? 'This strategy is eligible to save and activate for live validation.'
      : 'This strategy is eligible to save and can proceed through simulated validation.';
  }

  return {
    narrative,totalRules:learned.length,automaticRules,manualRules,externalRules,tradingStyle,
    instrumentLabel:`${profile.instruments.length} ${profile.instruments.length===1?'Instrument':'Instruments'}`,
    sessionLabel:`${sessions.length} Trading ${sessions.length===1?'Session':'Sessions'}`,
    readiness,
    persistable,
    canSimulate,
    canSave,
    canActivate,
    supportedRuleCount:supportedEnabled.length,
    requiredRuleCount:requiredSupported.length,
    optionalRuleCount:optionalSupported.length,
    unsupportedRuleCount:unsupportedEnabled.length,
    manualOptionalRuleCount:manualOptionalRules.length,
    statusDetail,
  };
}
