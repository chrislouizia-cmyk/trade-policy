export type TraderProfileTrade = {
  status?: string | null;
  outcome?: string | null;
  risk_percent?: number | string | null;
  taken_against_verdict?: boolean | null;
  opened_at?: string | null;
  closed_at?: string | null;
  post_analysis?: {
    executionQuality?: string | null;
    ruleViolations?: unknown;
  } | null;
};

export type TraderProfileMetric = {
  key:'discipline'|'accuracy'|'execution'|'strategy'|'riskControl';
  label:string;
  value:number|null;
  detail:string;
};

export type ObservedTraderProfile = {
  sampleSize:number;
  confidence:'INSUFFICIENT'|'EARLY'|'ESTABLISHED';
  observedType:string|null;
  averageHoldMinutes:number|null;
  metrics:TraderProfileMetric[];
};

const percent=(numerator:number,denominator:number)=>denominator>0?Math.round((numerator/denominator)*100):null;
const numeric=(value:unknown)=>typeof value==='number'?value:typeof value==='string'&&value.trim()!==''?Number(value):null;

function observedType(averageHoldMinutes:number|null):string|null{
  if(averageHoldMinutes===null)return null;
  if(averageHoldMinutes<60)return 'Scalper';
  if(averageHoldMinutes<24*60)return 'Day trader';
  if(averageHoldMinutes<7*24*60)return 'Swing trader';
  return 'Position trader';
}

export function buildObservedTraderProfile(trades:readonly TraderProfileTrade[],maximumRiskPercent:number|null):ObservedTraderProfile{
  const closed=trades.filter(trade=>trade.status==='CLOSED'&&Boolean(trade.closed_at));
  const sampleSize=closed.length;
  const confidence=sampleSize<5?'INSUFFICIENT':sampleSize<20?'EARLY':'ESTABLISHED';
  const durations=closed.flatMap(trade=>{
    const opened=trade.opened_at?Date.parse(trade.opened_at):Number.NaN;
    const closedAt=trade.closed_at?Date.parse(trade.closed_at):Number.NaN;
    return Number.isFinite(opened)&&Number.isFinite(closedAt)&&closedAt>=opened?[(closedAt-opened)/60_000]:[];
  });
  const averageHoldMinutes=durations.length?Math.round(durations.reduce((sum,value)=>sum+value,0)/durations.length):null;
  const wins=closed.filter(trade=>trade.outcome==='WIN').length;
  const compliant=closed.filter(trade=>!trade.taken_against_verdict).length;
  const reviewed=closed.filter(trade=>trade.post_analysis&&typeof trade.post_analysis==='object');
  const executionScores=reviewed.flatMap(trade=>{
    const quality=trade.post_analysis?.executionQuality;
    if(quality==='GOOD')return [100];
    if(quality==='MIXED')return [60];
    if(quality==='POOR')return [20];
    return [];
  });
  const strategyAligned=reviewed.filter(trade=>Array.isArray(trade.post_analysis?.ruleViolations)&&trade.post_analysis?.ruleViolations.length===0).length;
  const riskRows=closed.flatMap(trade=>{
    const risk=numeric(trade.risk_percent);
    return risk!==null&&Number.isFinite(risk)?[risk]:[];
  });
  const withinRisk=maximumRiskPercent===null?null:percent(riskRows.filter(risk=>risk<=maximumRiskPercent).length,riskRows.length);
  return {
    sampleSize,
    confidence,
    observedType:observedType(averageHoldMinutes),
    averageHoldMinutes,
    metrics:[
      {key:'discipline',label:'Discipline',value:percent(compliant,sampleSize),detail:'Trades taken without overriding a Trade Police verdict.'},
      {key:'accuracy',label:'Accuracy',value:percent(wins,sampleSize),detail:'Closed executed trades recorded as wins.'},
      {key:'execution',label:'Execution',value:executionScores.length?Math.round(executionScores.reduce((sum,value)=>sum+value,0)/executionScores.length):null,detail:'Execution quality recorded during post-trade review.'},
      {key:'strategy',label:'Strategy fidelity',value:reviewed.length?percent(strategyAligned,reviewed.length):null,detail:'Reviewed trades with no recorded rule violation.'},
      {key:'riskControl',label:'Risk control',value:withinRisk,detail:maximumRiskPercent===null?'No active strategy risk limit is available.':`Trades at or below the active ${maximumRiskPercent}% risk limit.`},
    ],
  };
}
