import type { StrategyProfile, StrategyRule } from '../types/trade.ts';

export type TradingDnaSummary={
  markets:string;
  tradingStyle:string;
  riskModel:string;
  automaticRules:StrategyRule[];
  manualRules:StrategyRule[];
  externalRules:StrategyRule[];
  explanation:string[];
};

const instrumentNames:Record<string,string>={XAUUSD:'Gold',XAGUSD:'Silver'};

function words(value:string){return value.replaceAll('-',' ').replace(/\b\w/g,letter=>letter.toUpperCase())}
function joinLabels(rules:StrategyRule[]){return new Intl.ListFormat('en',{style:'long',type:'conjunction'}).format(rules.map(rule=>rule.label))}
function marketName(symbol:string){return instrumentNames[symbol]??symbol}

export function buildStrategyLearningSummary(profile:StrategyProfile,rules:StrategyRule[]):TradingDnaSummary{
  const enabled=rules.filter(rule=>rule.enabled);
  const automaticRules=enabled.filter(rule=>(rule.evaluationMode??'AUTOMATIC')==='AUTOMATIC');
  const manualRules=enabled.filter(rule=>rule.evaluationMode==='MANUAL');
  const externalRules=enabled.filter(rule=>rule.evaluationMode==='EXTERNAL');
  const markets=new Intl.ListFormat('en',{style:'long',type:'conjunction'}).format(profile.instruments.map(marketName));
  const tradingStyle=words(profile.tradingStyle??'day-trading');
  const explanation:string[]=[`You are a ${tradingStyle.toLowerCase()} trader focused on ${markets}.`];

  if(profile.requireTrendAlignment)explanation.push(`I will first verify that your ${profile.trendTimeframe} trend agrees with the ${profile.confirmationTimeframe} confirmation context.`);
  if(automaticRules.length)explanation.push(`Then I will automatically evaluate ${joinLabels(automaticRules)} across your configured market layers.`);
  explanation.push(`Before approving an entry, I will verify your maximum ${profile.maximumRiskPercent}% risk per trade and minimum 1:${profile.minimumRR} risk/reward requirement.`);
  if(manualRules.length)explanation.push(`I will ask you to confirm ${joinLabels(manualRules)} before the decision is complete.`);
  if(externalRules.length)explanation.push(`I will keep ${joinLabels(externalRules)} pending until their external sources provide evidence.`);
  if(!manualRules.length&&!externalRules.length)explanation.push('Your enabled evidence is fully automatic, so no additional confirmation source is required.');

  return {markets,tradingStyle,riskModel:`Maximum ${profile.maximumRiskPercent}% per trade · Minimum RR 1:${profile.minimumRR}`,automaticRules,manualRules,externalRules,explanation};
}
