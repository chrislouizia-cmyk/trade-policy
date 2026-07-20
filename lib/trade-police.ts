import { DEFAULT_STRATEGY_PROFILE } from '../types/trade.ts';
import type { EvidenceKey, StrategyProfile, TradeInput, TradeResult } from '../types/trade.ts';
const round=(n:number,digits=2)=>Number(n.toFixed(digits));
const labels:Record<EvidenceKey,string>={
  h4TrendAligned:'Trend timeframe aligned',h1TrendAligned:'Confirmation timeframe aligned',
  structurePattern:'HH/HL or LH/LL structure',liquiditySweep:'Liquidity sweep',
  chochConfirmed:'ChoCH confirmed',bosConfirmed:'BoS confirmed',orderBlock:'Valid order block',
  fairValueGap:'Valid fair value gap',retestConfirmed:'Retest / rejection confirmed'
};
export function validateTrade(input:TradeInput):TradeResult{
  const p:StrategyProfile=input.strategyProfile||DEFAULT_STRATEGY_PROFILE;
  const instrumentStopLimit=p.stopLimits[input.instrument]??Number.POSITIVE_INFINITY;
  const riskDistance=Math.abs(input.entry-input.stopLoss), rewardDistance=Math.abs(input.takeProfit-input.entry);
  const rr=riskDistance>0?rewardDistance/riskDistance:0;
  const evidenceKeys=Object.keys(p.evidenceWeights) as EvidenceKey[];
  const evidencePossible=evidenceKeys.reduce((s,k)=>s+(p.evidenceWeights[k]||0),0);
  const contextItems=[
    {label:`RR at least 1:${p.minimumRR}`,earned:rr>=p.minimumRR?7:0,possible:7},
    {label:'Stop within strategy limit',earned:riskDistance<=instrumentStopLimit?4:0,possible:4},
    {label:`Risk at or below ${p.maximumRiskPercent}%`,earned:input.riskPercent<=p.maximumRiskPercent?4:0,possible:4},
    {label:'Allowed session',earned:p.allowedSessions.includes(input.session)?3:0,possible:3},
    {label:'News rule respected',earned:(!p.avoidHighImpactNews||!input.highImpactNews)?2:0,possible:2}
  ];
  const raw=[...evidenceKeys.map(k=>({label:labels[k],earned:input[k]?p.evidenceWeights[k]:0,possible:p.evidenceWeights[k]})),...contextItems];
  const possible=raw.reduce((s,i)=>s+i.possible,0)||1;
  const scoreItems=raw.map(i=>({...i,earned:round((i.earned/possible)*100),possible:round((i.possible/possible)*100)}));
  const score=round((raw.reduce((s,i)=>s+i.earned,0)/possible)*100);
  const vetoes:string[]=[],observations:string[]=[];
  if(!p.instruments.includes(input.instrument))vetoes.push('Instrument is not enabled in this strategy.');
  if(p.requireTrendAlignment&&(!input.h4TrendAligned||!input.h1TrendAligned))vetoes.push('Required timeframe alignment is missing.');
  p.requiredEvidence.forEach(k=>{if(!input[k])vetoes.push(`${labels[k]} is mandatory.`)});
  if(rr<p.minimumRR)vetoes.push(`RR is ${round(rr)}; strategy minimum is ${p.minimumRR}.`);
  if(input.riskPercent>p.maximumRiskPercent)vetoes.push(`Risk exceeds ${p.maximumRiskPercent}%.`);
  if(input.tradesToday>=p.maximumTradesPerDay)vetoes.push('Daily trade limit already reached.');
  if(!p.allowedSessions.includes(input.session))vetoes.push('Session is not allowed by this strategy.');
  if(riskDistance>instrumentStopLimit)vetoes.push('Stop distance exceeds this strategy limit.');
  if(p.avoidHighImpactNews&&input.highImpactNews)vetoes.push('High-impact news conflict detected.');
  if(!input.orderBlock&&!input.fairValueGap)observations.push('No valid OB or FVG identified.');
  if(!input.retestConfirmed)observations.push('Retest or rejection is still pending.');
  const grade=score>=90?'A+':score>=p.authorizationScore?'A':score>=p.waitScore?'B':'C';
  const verdict=vetoes.length?'REJECTED':score>=p.authorizationScore?'AUTHORIZED':score>=p.waitScore?'WAIT':'REJECTED';
  return{score,grade,verdict,rr:round(rr),riskAmount:round(input.accountBalance*(input.riskPercent/100)),stopDistance:round(riskDistance,5),vetoes:[...new Set(vetoes)],observations,scoreItems};
}
