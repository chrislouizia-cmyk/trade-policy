import type { StrategyProfile, StrategyRule, StrategySession, TradingStyle } from '../types/trade.ts';

const marketNames:Record<string,string>={XAUUSD:'Gold',XAGUSD:'Silver'};
const styleNames:Record<TradingStyle,string>={scalping:'Scalper','day-trading':'Day Trader',swing:'Swing Trader',position:'Position Trader'};

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
};

function list(values:string[]){return new Intl.ListFormat('en',{style:'long',type:'conjunction'}).format(values)}

export function buildFinalReviewSummary(profile:StrategyProfile,rules:StrategyRule[],sessions:StrategySession[]):FinalReviewSummary{
  const enabled=rules.filter(rule=>rule.enabled);
  const learned=enabled.length?enabled:rules;
  const automaticRules=learned.filter(rule=>(rule.evaluationMode??'AUTOMATIC')==='AUTOMATIC').length;
  const manualRules=learned.filter(rule=>rule.evaluationMode==='MANUAL').length;
  const externalRules=learned.filter(rule=>rule.evaluationMode==='EXTERNAL').length;
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
  return {
    narrative,totalRules:learned.length,automaticRules,manualRules,externalRules,tradingStyle,
    instrumentLabel:`${profile.instruments.length} ${profile.instruments.length===1?'Instrument':'Instruments'}`,
    sessionLabel:`${sessions.length} Trading ${sessions.length===1?'Session':'Sessions'}`,
    readiness:profile.id?'Ready for live analysis':'Ready for simulated validation',
  };
}
