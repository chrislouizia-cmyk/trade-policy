import type { Direction, EvidenceKey, Instrument, StrategyProfile } from '@/types/trade';

export type Candle={datetime:string;open:number;high:number;low:number;close:number;volume?:number};
export type AnalysisStatus='DATA_UNAVAILABLE'|'INSUFFICIENT_CANDLES'|'ANALYSIS_FAILED'|'NO_RELEVANT_EVIDENCE'|'VALID_ANALYSIS';
export type TimeframeAnalysis={timeframe:string;bias:'BULLISH'|'BEARISH'|'RANGE'|'UNCLEAR';lastPrice:number;atr:number;lastSwingHigh:number|null;lastSwingLow:number|null;bosUp:boolean;bosDown:boolean;sweepHigh:boolean;sweepLow:boolean;fvgBullish:boolean;fvgBearish:boolean;retest:boolean;};
export type LiveCandidate={id:string;direction:Direction;entryLow:number;entryHigh:number;stopLoss:number;takeProfit:number;rr:number;status:'READY'|'WAIT'|'INVALID';rationale:string};
export type EvidenceAssessment={value:boolean;confidence:number;reason:string};
export type ConfidenceBreakdown={mandatoryConfirmed:EvidenceKey[];mandatoryMissing:EvidenceKey[];optionalConfirmed:EvidenceKey[];contradicted:string[]};
export type ConfidenceComponents={mandatoryScore:number;optionalScore:number;alignmentScore:number;contradictionPenalty:number};
export type LiveMarketAnalysis={status:AnalysisStatus;instrument:Instrument;timeframe:string;strategyId:string|null;provider:string;calculatedAt:string;latestCandleTimestamp:string;liveAnalysisConfidence:number;strategyConfidenceThreshold:number;detectedTimeframes:string[];h4Bias:TimeframeAnalysis['bias'];h1Bias:TimeframeAnalysis['bias'];timeframes:Record<string,TimeframeAnalysis>;suggestedDirection:Direction|null;setupType:string;evidence:Record<EvidenceKey,EvidenceAssessment>;breakdown:ConfidenceBreakdown;components:ConfidenceComponents;candidates:LiveCandidate[];warnings:string[];summary:string;};

export class MarketAnalysisError extends Error {
  status:Exclude<AnalysisStatus,'VALID_ANALYSIS'|'NO_RELEVANT_EVIDENCE'>;
  constructor(status:Exclude<AnalysisStatus,'VALID_ANALYSIS'|'NO_RELEVANT_EVIDENCE'>,message:string){super(message);this.name='MarketAnalysisError';this.status=status;}
}

const evidenceKeys:EvidenceKey[]=['h4TrendAligned','h1TrendAligned','structurePattern','liquiditySweep','chochConfirmed','bosConfirmed','orderBlock','fairValueGap','retestConfirmed'];
const avg=(v:number[])=>v.length?v.reduce((a,b)=>a+b,0)/v.length:0;
const round=(n:number,d=5)=>Number(n.toFixed(d));
function atr(c:Candle[],p=14){const xs=c.slice(-p-1);const tr=xs.slice(1).map((x,i)=>Math.max(x.high-x.low,Math.abs(x.high-xs[i].close),Math.abs(x.low-xs[i].close)));return avg(tr);}
function analyzeTf(timeframe:string,c:Candle[]):TimeframeAnalysis{
  const last=c.at(-1)!; const fast=avg(c.slice(-10).map(x=>x.close)); const slow=avg(c.slice(-24).map(x=>x.close));
  const recent=c.slice(-8,-1), prior=c.slice(-20,-8); const recentHigh=Math.max(...recent.map(x=>x.high)),recentLow=Math.min(...recent.map(x=>x.low)); const priorHigh=Math.max(...prior.map(x=>x.high)),priorLow=Math.min(...prior.map(x=>x.low));
  const bosUp=last.close>priorHigh, bosDown=last.close<priorLow; const sweepHigh=last.high>priorHigh&&last.close<priorHigh; const sweepLow=last.low<priorLow&&last.close>priorLow;
  let bias:'BULLISH'|'BEARISH'|'RANGE'='RANGE'; if(fast>slow&&last.close>slow)bias='BULLISH'; else if(fast<slow&&last.close<slow)bias='BEARISH';
  const a=atr(c); const fvgBullish=last.low>c.at(-3)!.high; const fvgBearish=last.high<c.at(-3)!.low;
  const retest=Math.abs(last.close-(bias==='BULLISH'?recentHigh:recentLow))<=Math.max(a*.35,last.close*.0002);
  return {timeframe,bias,lastPrice:last.close,atr:round(a),lastSwingHigh:round(recentHigh),lastSwingLow:round(recentLow),bosUp,bosDown,sweepHigh,sweepLow,fvgBullish,fvgBearish,retest};
}

function validateSeries(strategy:StrategyProfile,series:Record<string,Candle[]>){
  const frames=[strategy.trendTimeframe,strategy.confirmationTimeframe,strategy.entryTimeframe];
  for(const frame of frames){
    const candles=series[frame];
    if(!candles?.length)throw new MarketAnalysisError('DATA_UNAVAILABLE',`No candles returned for ${frame}.`);
    if(candles.length<25)throw new MarketAnalysisError('INSUFFICIENT_CANDLES',`${frame} returned ${candles.length} candles; at least 25 are required.`);
    if(candles.some(x=>![x.open,x.high,x.low,x.close].every(Number.isFinite)))throw new MarketAnalysisError('DATA_UNAVAILABLE',`${frame} contains invalid OHLC values.`);
    const latest=Date.parse(candles.at(-1)!.datetime.replace(' ','T'));
    if(!Number.isFinite(latest))throw new MarketAnalysisError('DATA_UNAVAILABLE',`${frame} has an invalid latest candle timestamp.`);
    const minutes:Record<string,number>={M1:1,M3:3,M5:5,M15:15,M30:30,H1:60,H2:120,H4:240,H6:360,H8:480,H12:720,D1:1440,W1:10080,MN:43200};
    if(!minutes[frame])throw new MarketAnalysisError('DATA_UNAVAILABLE',`${frame} is not supported by the market-data provider.`);
    if(Date.now()-latest>minutes[frame]*60_000*4+72*60*60_000)throw new MarketAnalysisError('DATA_UNAVAILABLE',`${frame} market data is stale.`);
  }
  const requiresVolume=JSON.stringify(strategy.strategyMethodologies??[]).toLowerCase().includes('volume');
  if(requiresVolume&&frames.some(frame=>series[frame].some(x=>!Number.isFinite(x.volume))))throw new MarketAnalysisError('DATA_UNAVAILABLE','This strategy requires volume, but the provider did not return it.');
}

function scoreConfidence(strategy:StrategyProfile,evidence:Record<EvidenceKey,EvidenceAssessment>,aligned:boolean){
  const configuredRules=(strategy.rules??[]).filter(r=>r.enabled&&evidenceKeys.includes(r.ruleKey as EvidenceKey));
  const relevant=configuredRules.length?configuredRules.map(r=>r.ruleKey as EvidenceKey):evidenceKeys.filter(k=>strategy.requiredEvidence.includes(k)||(strategy.evidenceWeights[k]??0)>0);
  if(!relevant.length)throw new MarketAnalysisError('ANALYSIS_FAILED','Strategy configuration incomplete: no relevant evidence rules are configured.');
  const mandatory=new Set(configuredRules.length?configuredRules.filter(r=>r.mandatory).map(r=>r.ruleKey as EvidenceKey):strategy.requiredEvidence);
  const optional=relevant.filter(k=>!mandatory.has(k));
  const confirmedMandatory=[...mandatory].filter(k=>evidence[k]?.value);
  const missingMandatory=[...mandatory].filter(k=>!evidence[k]?.value);
  const confirmedOptional=optional.filter(k=>evidence[k]?.value);
  const weighted=(keys:EvidenceKey[],confirmed:EvidenceKey[],maximum:number)=>{const total=keys.reduce((n,k)=>n+Math.max(0,strategy.evidenceWeights[k]??1),0);if(!total)return 0;return Math.round(confirmed.reduce((n,k)=>n+Math.max(0,strategy.evidenceWeights[k]??1),0)/total*maximum);};
  const mandatoryScore=weighted([...mandatory],confirmedMandatory,60);
  const optionalScore=weighted(optional,confirmedOptional,25);
  const alignmentScore=aligned?15:0;
  const contradicted:string[]=[];
  if(strategy.requireTrendAlignment&&!aligned)contradicted.push('Required trend and confirmation timeframes are not aligned.');
  const contradictionPenalty=contradicted.length?-Math.min(15,mandatoryScore+optionalScore+alignmentScore):0;
  const components={mandatoryScore,optionalScore,alignmentScore,contradictionPenalty};
  const liveAnalysisConfidence=Math.max(0,Math.min(100,Object.values(components).reduce((a,b)=>a+b,0)));
  return {liveAnalysisConfidence,components,breakdown:{mandatoryConfirmed:confirmedMandatory,mandatoryMissing:missingMandatory,optionalConfirmed:confirmedOptional,contradicted},relevant};
}

export function buildLiveAnalysis(instrument:Instrument,strategy:StrategyProfile,series:Record<string,Candle[]>,provider:string):LiveMarketAnalysis{
  validateSeries(strategy,series);
  const t=analyzeTf(strategy.trendTimeframe,series[strategy.trendTimeframe]); const c=analyzeTf(strategy.confirmationTimeframe,series[strategy.confirmationTimeframe]); const e=analyzeTf(strategy.entryTimeframe,series[strategy.entryTimeframe]);
  const aligned=t.bias!=='RANGE'&&t.bias===c.bias; const direction:Direction|null=aligned?(t.bias==='BULLISH'?'BUY':'SELL'):null;
  const bullish=direction==='BUY', bearish=direction==='SELL'; const structure=aligned&&(bullish?(c.bosUp||e.bosUp):(c.bosDown||e.bosDown)); const sweep=bullish?(c.sweepLow||e.sweepLow):bearish?(c.sweepHigh||e.sweepHigh):false; const bos=bullish?(c.bosUp||e.bosUp):bearish?(c.bosDown||e.bosDown):false; const fvg=bullish?(c.fvgBullish||e.fvgBullish):bearish?(c.fvgBearish||e.fvgBearish):false; const retest=c.retest||e.retest;
  const ev=(value:boolean,reason:string,confidence=value?100:0)=>({value,confidence,reason});
  const evidence:Record<EvidenceKey,EvidenceAssessment>={h4TrendAligned:ev(t.bias!=='RANGE',`${strategy.trendTimeframe} bias is ${t.bias}.`),h1TrendAligned:ev(aligned,`${strategy.confirmationTimeframe} bias is ${c.bias}; trend bias is ${t.bias}.`),structurePattern:ev(structure,structure?'A directional break is present.':'No directional break is confirmed.'),liquiditySweep:ev(sweep,sweep?'A prior swing was swept.':'No qualifying sweep was detected.'),chochConfirmed:ev(sweep&&bos,sweep&&bos?'Sweep and directional break confirm ChoCH.':'ChoCH sequence is incomplete.'),bosConfirmed:ev(bos,bos?'A close exceeded a prior swing.':'No break of structure is confirmed.'),orderBlock:ev(false,'Order blocks are not inferred from OHLC alone.'),fairValueGap:ev(fvg,fvg?'A three-candle imbalance was detected.':'No current three-candle imbalance.'),retestConfirmed:ev(retest,retest?'Price is retesting a structural level.':'Retest is not confirmed.')};
  const scored=scoreConfidence(strategy,evidence,aligned);
  const status:AnalysisStatus=scored.relevant.some(k=>evidence[k].value)?'VALID_ANALYSIS':'NO_RELEVANT_EVIDENCE';
  const warnings=[...scored.breakdown.contradicted]; if(!direction)warnings.push('No directional setup is currently supported by the configured evidence.');
  const candidates:LiveCandidate[]=[]; if(direction){const entry=e.lastPrice;const stopBase=direction==='BUY'?(e.lastSwingLow??entry-e.atr):(e.lastSwingHigh??entry+e.atr);const maxStop=strategy.stopLimits[instrument]??Math.max(e.atr*2,e.lastPrice*.01);const dist=Math.min(Math.abs(entry-stopBase)||e.atr||maxStop,maxStop);candidates.push({id:'live-primary',direction,entryLow:round(entry),entryHigh:round(entry),stopLoss:round(direction==='BUY'?entry-dist:entry+dist),takeProfit:round(direction==='BUY'?entry+dist*strategy.minimumRR:entry-dist*strategy.minimumRR),rr:strategy.minimumRR,status:aligned&&bos&&retest?'READY':'WAIT',rationale:aligned&&bos&&retest?'Trend, break, and retest conditions are aligned.':'Directional context exists, but the configured entry evidence is incomplete.'});}
  const latestCandleTimestamp=[...Object.values(series).map(v=>v.at(-1)!.datetime)].sort().at(-1)!;
  return {status,instrument,timeframe:strategy.confirmationTimeframe,strategyId:strategy.id??null,provider,calculatedAt:new Date().toISOString(),latestCandleTimestamp,liveAnalysisConfidence:scored.liveAnalysisConfidence,strategyConfidenceThreshold:strategy.aiBehavior?.confidenceThreshold??strategy.waitScore,detectedTimeframes:[strategy.trendTimeframe,strategy.confirmationTimeframe,strategy.entryTimeframe],h4Bias:t.bias,h1Bias:c.bias,timeframes:{[strategy.trendTimeframe]:t,[strategy.confirmationTimeframe]:c,[strategy.entryTimeframe]:e},suggestedDirection:direction,setupType:sweep&&bos?'Liquidity Sweep + ChoCH + BoS':fvg?'FVG Retest':aligned?'Continuation':'Unclear',evidence,breakdown:scored.breakdown,components:scored.components,candidates,warnings,summary:status==='NO_RELEVANT_EVIDENCE'?`${instrument} has valid market data but no evidence relevant to the active strategy setup.`:direction?`${instrument} has a ${direction} bias under the active strategy.`:`${instrument} has no aligned directional bias under the active strategy.`};
}
