import type { Direction, EvidenceKey, Instrument, StrategyProfile } from '@/types/trade';

export type Candle={datetime:string;open:number;high:number;low:number;close:number;volume?:number};
export type AnalysisStatus='DATA_UNAVAILABLE'|'INSUFFICIENT_DATA'|'STRATEGY_UNSUPPORTED'|'STRATEGY_INCOMPLETE'|'ANALYSIS_FAILED'|'NO_RELEVANT_EVIDENCE'|'VALID_ANALYSIS';
export type TimeframeAnalysis={timeframe:string;bias:'BULLISH'|'BEARISH'|'RANGE'|'UNCLEAR';lastPrice:number;atr:number;lastSwingHigh:number|null;lastSwingLow:number|null;bosUp:boolean;bosDown:boolean;sweepHigh:boolean;sweepLow:boolean;fvgBullish:boolean;fvgBearish:boolean;retest:boolean;};
export type LiveCandidate={id:string;direction:Direction;entryLow:number;entryHigh:number;stopLoss:number;takeProfit:number;rr:number;status:'READY'|'WAIT'|'INVALID';rationale:string};
export type EvidenceAssessment={value:boolean;confidence:number;reason:string};
export type ConfidenceBreakdown={mandatoryConfirmed:string[];mandatoryMissing:string[];optionalConfirmed:string[];contradicted:string[];unsupported:string[]};
export type ConfidenceComponents={mandatoryScore:number;optionalScore:number;alignmentScore:number;contradictionPenalty:number};
export type LiveMarketAnalysis={status:AnalysisStatus;analysisStatus:AnalysisStatus;instrument:Instrument;timeframe:string;strategyId:string|null;strategySchemaVersion:number;methodologyIds:string[];primaryMethodology:string|null;provider:string;providerSymbol:string;calculatedAt:string;latestCandleTimestamp:string;liveAnalysisConfidence:number|null;strategyConfidenceThreshold:number;detectedTimeframes:string[];h4Bias:TimeframeAnalysis['bias'];h1Bias:TimeframeAnalysis['bias'];timeframeAligned:boolean;timeframes:Record<string,TimeframeAnalysis>;suggestedDirection:Direction|null;direction:Direction|null;setupType:string;evidence:Record<string,EvidenceAssessment>;breakdown:ConfidenceBreakdown;components:ConfidenceComponents;candidates:LiveCandidate[];warnings:string[];summary:string;};

export class MarketAnalysisError extends Error {
  status:'DATA_UNAVAILABLE'|'INSUFFICIENT_DATA'|'ANALYSIS_FAILED';
  constructor(status:'DATA_UNAVAILABLE'|'INSUFFICIENT_DATA'|'ANALYSIS_FAILED',message:string){super(message);this.name='MarketAnalysisError';this.status=status;}
}

export const DETECTOR_EVIDENCE_IDS=['h4TrendAligned','h1TrendAligned','structurePattern','liquiditySweep','chochConfirmed','bosConfirmed','fairValueGap','retestConfirmed','displacement','premiumDiscount','rejectionCandle','volumeConfirmation','volatilityRequirement'] as const;
export const UNREACHABLE_EVIDENCE_IDS=['orderBlock','sessionRequirement','newsFilter','correlationFilter','spreadFilter'] as const;
const aliases:Record<string,string>={support_resistance:'structurePattern',SUPPORT_RESISTANCE:'structurePattern',market_structure:'structurePattern',MARKET_STRUCTURE:'structurePattern',BREAK_OF_STRUCTURE:'bosConfirmed',fvg:'fairValueGap',FAIR_VALUE_GAP:'fairValueGap',breakout_close:'bosConfirmed',CLOSE_BEYOND_LEVEL:'bosConfirmed',trend_alignment:'h4TrendAligned',HTF_TREND_ALIGNMENT:'h4TrendAligned',liquidity_sweep:'liquiditySweep',LIQUIDITY_GRAB:'liquiditySweep'};
export function normalizeEvidenceId(id:string){return aliases[id]??id;}
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
    if(candles.length<25)throw new MarketAnalysisError('INSUFFICIENT_DATA',`${frame} returned ${candles.length} candles; at least 25 are required.`);
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

function scoreConfidence(strategy:StrategyProfile,evidence:Record<string,EvidenceAssessment>,aligned:boolean){
  const enabled=(strategy.rules??[]).filter(r=>r.enabled).map(r=>({...r,normalizedId:normalizeEvidenceId(r.ruleKey)}));
  const supported=(id:string)=>(DETECTOR_EVIDENCE_IDS as readonly string[]).includes(id);
  const configuredRules=enabled.filter(r=>supported(r.normalizedId));
  const unsupported=enabled.filter(r=>!supported(r.normalizedId)).map(r=>r.ruleKey);
  const fallback=Object.keys(strategy.evidenceWeights??{}).map(normalizeEvidenceId).filter(supported);
  const relevant=configuredRules.length?configuredRules.map(r=>r.normalizedId):fallback;
  const mandatory=new Set(configuredRules.length?configuredRules.filter(r=>r.mandatory).map(r=>r.normalizedId):strategy.requiredEvidence.map(normalizeEvidenceId));
  const optional=relevant.filter(k=>!mandatory.has(k));
  const confirmedMandatory=[...mandatory].filter(k=>evidence[k]?.value);
  const missingMandatory=[...mandatory].filter(k=>!evidence[k]?.value);
  const confirmedOptional=optional.filter(k=>evidence[k]?.value);
  const weighted=(keys:string[],confirmed:string[],maximum:number)=>{const weight=(key:string)=>{const raw=enabled.find(r=>r.normalizedId===key)?.weight??strategy.evidenceWeights[key as EvidenceKey]??1;return Math.max(0,raw)};const total=keys.reduce((n,k)=>n+weight(k),0);if(!total)return 0;return Math.round(confirmed.reduce((n,k)=>n+weight(k),0)/total*maximum);};
  const mandatoryScore=weighted([...mandatory],confirmedMandatory,60);
  const optionalScore=weighted(optional,confirmedOptional,25);
  const alignmentScore=aligned?15:0;
  const contradicted:string[]=[];
  if(strategy.requireTrendAlignment&&!aligned)contradicted.push('Required trend and confirmation timeframes are not aligned.');
  const contradictionPenalty=contradicted.length?-Math.min(15,mandatoryScore+optionalScore+alignmentScore):0;
  const components={mandatoryScore,optionalScore,alignmentScore,contradictionPenalty};
  const liveAnalysisConfidence=Math.max(0,Math.min(100,Object.values(components).reduce((a,b)=>a+b,0)));
  return {liveAnalysisConfidence,components,breakdown:{mandatoryConfirmed:confirmedMandatory,mandatoryMissing:missingMandatory,optionalConfirmed:confirmedOptional,contradicted,unsupported},relevant};
}

export function buildLiveAnalysis(instrument:Instrument,strategy:StrategyProfile,series:Record<string,Candle[]>,provider:string,normalizedProviderSymbol=instrument):LiveMarketAnalysis{
  validateSeries(strategy,series);
  const t=analyzeTf(strategy.trendTimeframe,series[strategy.trendTimeframe]); const c=analyzeTf(strategy.confirmationTimeframe,series[strategy.confirmationTimeframe]); const e=analyzeTf(strategy.entryTimeframe,series[strategy.entryTimeframe]);
  const aligned=t.bias!=='RANGE'&&t.bias===c.bias; const direction:Direction|null=aligned?(t.bias==='BULLISH'?'BUY':'SELL'):null;
  const bullish=direction==='BUY', bearish=direction==='SELL'; const structure=aligned&&(bullish?(c.bosUp||e.bosUp):(c.bosDown||e.bosDown)); const sweep=bullish?(c.sweepLow||e.sweepLow):bearish?(c.sweepHigh||e.sweepHigh):false; const bos=bullish?(c.bosUp||e.bosUp):bearish?(c.bosDown||e.bosDown):false; const fvg=bullish?(c.fvgBullish||e.fvgBullish):bearish?(c.fvgBearish||e.fvgBearish):false; const retest=c.retest||e.retest;
  const last=series[strategy.entryTimeframe].at(-1)!;const previous=series[strategy.entryTimeframe].at(-2)!;const body=Math.abs(last.close-last.open);const range=Math.max(last.high-last.low,Number.EPSILON);const displacement=body>Math.max(e.atr*1.1,range*.65);const rejectionCandle=(last.high-Math.max(last.open,last.close)>body*1.5)||(Math.min(last.open,last.close)-last.low>body*1.5);const premiumDiscount=Boolean(direction)&&e.lastSwingHigh!=null&&e.lastSwingLow!=null&&(last.close>(e.lastSwingHigh+e.lastSwingLow)/2)===bullish;const volumeConfirmation=Number.isFinite(last.volume)&&Number.isFinite(previous.volume)&&last.volume!>previous.volume!*1.15;const volatilityRequirement=e.atr>0&&range>=e.atr*.8;
  const ev=(value:boolean,reason:string,confidence=value?100:0)=>({value,confidence,reason});
  const evidence:Record<string,EvidenceAssessment>={h4TrendAligned:ev(t.bias!=='RANGE',`${strategy.trendTimeframe} bias is ${t.bias}.`),h1TrendAligned:ev(aligned,`${strategy.confirmationTimeframe} bias is ${c.bias}; trend bias is ${t.bias}.`),structurePattern:ev(structure,structure?'A directional break is present.':'No directional break is confirmed.'),liquiditySweep:ev(sweep,sweep?'A prior swing was swept.':'No qualifying sweep was detected.'),chochConfirmed:ev(sweep&&bos,sweep&&bos?'Sweep and directional break confirm ChoCH.':'ChoCH sequence is incomplete.'),bosConfirmed:ev(bos,bos?'A close exceeded a prior swing.':'No break of structure is confirmed.'),orderBlock:ev(false,'Order blocks require richer structure or screenshot analysis.'),fairValueGap:ev(fvg,fvg?'A three-candle imbalance was detected.':'No current three-candle imbalance.'),retestConfirmed:ev(retest,retest?'Price is retesting a structural level.':'Retest is not confirmed.'),displacement:ev(displacement,displacement?'The latest candle displaced beyond normal range.':'No displacement candle was detected.'),premiumDiscount:ev(premiumDiscount,premiumDiscount?'Price is in the directional premium/discount half of the recent range.':'Price is not in the configured directional half of the range.'),rejectionCandle:ev(rejectionCandle,rejectionCandle?'The latest candle has a qualifying rejection wick.':'No qualifying rejection candle was detected.'),volumeConfirmation:ev(volumeConfirmation,volumeConfirmation?'Latest volume expanded materially.':'Volume did not confirm or is unavailable.'),volatilityRequirement:ev(volatilityRequirement,volatilityRequirement?'Current range meets the ATR volatility requirement.':'Current range is below the ATR volatility requirement.')};
  const scored=scoreConfidence(strategy,evidence,aligned);
  const status:AnalysisStatus=scored.breakdown.unsupported.length?'STRATEGY_UNSUPPORTED':!scored.relevant.length?'STRATEGY_INCOMPLETE':scored.relevant.some(k=>evidence[k].value)?'VALID_ANALYSIS':'NO_RELEVANT_EVIDENCE';
  const warnings=[...scored.breakdown.contradicted];if(scored.breakdown.unsupported.length)warnings.push(`Unreachable live evidence: ${scored.breakdown.unsupported.join(', ')}.`);if(!direction)warnings.push('No directional setup is currently supported by the configured evidence.');
  const candidates:LiveCandidate[]=[]; if(direction){const entry=e.lastPrice;const stopBase=direction==='BUY'?(e.lastSwingLow??entry-e.atr):(e.lastSwingHigh??entry+e.atr);const maxStop=strategy.stopLimits[instrument]??Math.max(e.atr*2,e.lastPrice*.01);const dist=Math.min(Math.abs(entry-stopBase)||e.atr||maxStop,maxStop);candidates.push({id:'live-primary',direction,entryLow:round(entry),entryHigh:round(entry),stopLoss:round(direction==='BUY'?entry-dist:entry+dist),takeProfit:round(direction==='BUY'?entry+dist*strategy.minimumRR:entry-dist*strategy.minimumRR),rr:strategy.minimumRR,status:aligned&&bos&&retest?'READY':'WAIT',rationale:aligned&&bos&&retest?'Trend, break, and retest conditions are aligned.':'Directional context exists, but the configured entry evidence is incomplete.'});}
  const latestCandleTimestamp=[...Object.values(series).map(v=>v.at(-1)!.datetime)].sort().at(-1)!;
  const methodologyIds=(strategy.strategyMethodologies??[]).flatMap(item=>[item.category,...item.rules]);
  const summary=status==='STRATEGY_UNSUPPORTED'?'This strategy contains rules the live analyzer cannot evaluate yet.':status==='STRATEGY_INCOMPLETE'?'Update this legacy strategy before using live analysis.':status==='NO_RELEVANT_EVIDENCE'?`${instrument} has valid market data, but no setup was detected for this strategy.`:direction?`${instrument} has a ${direction} bias under the active strategy.`:`${instrument} has no aligned directional bias under the active strategy.`;
  return {status,analysisStatus:status,instrument,timeframe:strategy.confirmationTimeframe,strategyId:strategy.id??null,strategySchemaVersion:(strategy.rules??[]).length?2:1,methodologyIds,primaryMethodology:methodologyIds[0]??strategy.preferredSetups?.[0]??null,provider,providerSymbol:normalizedProviderSymbol,calculatedAt:new Date().toISOString(),latestCandleTimestamp,liveAnalysisConfidence:status==='VALID_ANALYSIS'?scored.liveAnalysisConfidence:null,strategyConfidenceThreshold:strategy.aiBehavior?.confidenceThreshold??strategy.waitScore,detectedTimeframes:[strategy.trendTimeframe,strategy.confirmationTimeframe,strategy.entryTimeframe],h4Bias:t.bias,h1Bias:c.bias,timeframeAligned:aligned,timeframes:{[strategy.trendTimeframe]:t,[strategy.confirmationTimeframe]:c,[strategy.entryTimeframe]:e},suggestedDirection:direction,direction,setupType:sweep&&bos?'Liquidity Sweep + ChoCH + BoS':fvg?'FVG Retest':aligned?'Continuation':'Unclear',evidence,breakdown:scored.breakdown,components:scored.components,candidates:status==='VALID_ANALYSIS'?candidates:[],warnings,summary};
}
