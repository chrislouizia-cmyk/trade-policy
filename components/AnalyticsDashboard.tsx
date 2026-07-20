'use client';

import {useMemo,useState} from 'react';

type Trade={
  id:string;
  pnl:number;
  r:number;
  openedAt:string;
  closedAt:string;
  instrument:string;
  strategy:string;
  session:string;
  outcome:string;
  direction:string;
  riskPercent:number;
  initialRR:number;
  setupType:string;
  compliant:boolean;
  overrideReason:string|null;
};

type Account={
  name:string;
  currency:string;
  startingBalance:number;
  currentBalance:number;
};

const ranges=['1D','7D','30D','3M','1Y','ALL'] as const;
type Range=(typeof ranges)[number];

export default function AnalyticsDashboard({account,trades}:{account:Account;trades:Trade[]}){
  const [range,setRange]=useState<Range>('30D');
  const filtered=useMemo(()=>filterRange(trades,range),[trades,range]);
  const analytics=useMemo(()=>calculateAnalytics(filtered,account.startingBalance),[filtered,account.startingBalance]);

  return <div className="stack">
    <section className="card analytics-hero">
      <div>
        <span className="eyebrow">PERFORMANCE INTELLIGENCE</span>
        <h1>Your trading, explained.</h1>
        <p className="muted">Understand where, when and why this account makes or loses money.</p>
      </div>
      <div className="range-tabs" aria-label="Analytics period">
        {ranges.map(item=><button className={range===item?'active':''} onClick={()=>setRange(item)} key={item}>{item}</button>)}
      </div>
    </section>

    <EquityChart
      startingBalance={account.startingBalance}
      currency={account.currency}
      points={analytics.curve}
      drawdown={analytics.drawdownCurve}
    />

    <div className="grid grid-4 metric-grid">
      <Metric label="Net P&L" value={money(analytics.pnl,account.currency)} />
      <Metric label="Win rate" value={`${analytics.winRate.toFixed(1)}%`} sub={`${analytics.wins} wins · ${analytics.losses} losses`} />
      <Metric label="Profit factor" value={analytics.profitFactor===Infinity?'∞':analytics.profitFactor.toFixed(2)} />
      <Metric label="Expectancy" value={`${analytics.expectancy.toFixed(2)}R`} />
      <Metric label="Average R" value={`${analytics.averageR.toFixed(2)}R`} />
      <Metric label="Maximum drawdown" value={`${analytics.maxDrawdownPercent.toFixed(2)}%`} sub={money(-analytics.maxDrawdown,account.currency)} />
      <Metric label="Average win" value={money(analytics.averageWin,account.currency)} />
      <Metric label="Average loss" value={money(-analytics.averageLoss,account.currency)} />
      <Metric label="Best trade" value={analytics.best?money(analytics.best.pnl,account.currency):'—'} sub={analytics.best?tradeLabel(analytics.best):''} />
      <Metric label="Worst trade" value={analytics.worst?money(analytics.worst.pnl,account.currency):'—'} sub={analytics.worst?tradeLabel(analytics.worst):''} />
      <Metric label="Winning streak" value={String(analytics.longestWinStreak)} />
      <Metric label="Losing streak" value={String(analytics.longestLossStreak)} />
    </div>

    <div className="grid grid-2">
      <Breakdown title="Performance by hour" rows={analytics.byHour} currency={account.currency} />
      <Breakdown title="Performance by weekday" rows={analytics.byWeekday} currency={account.currency} />
    </div>

    <div className="grid grid-2">
      <Breakdown title="Performance by session" rows={analytics.bySession} currency={account.currency} />
      <Breakdown title="Performance by instrument" rows={analytics.byInstrument} currency={account.currency} />
    </div>

    <div className="grid grid-2">
      <Breakdown title="Performance by strategy" rows={analytics.byStrategy} currency={account.currency} />
      <Breakdown title="Long vs short" rows={analytics.byDirection} currency={account.currency} />
    </div>

    <section className="card">
      <div className="section-title">
        <div><span className="eyebrow">DISCIPLINE INTELLIGENCE</span><h2>Following the plan vs overrides</h2></div>
      </div>
      <div className="grid grid-2">
        <DisciplineCard title="Compliant trades" row={analytics.compliance.compliant} currency={account.currency} />
        <DisciplineCard title="Override trades" row={analytics.compliance.override} currency={account.currency} />
      </div>
      <p className="muted">
        {analytics.compliance.message}
      </p>
    </section>

    <section className="card">
      <div className="section-title">
        <div><span className="eyebrow">ACCOUNT DETAIL</span><h2>Closed-trade ledger</h2></div>
      </div>
      {filtered.length?(
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead><tr><th align="left">Closed</th><th align="left">Instrument</th><th align="left">Strategy</th><th align="left">Session</th><th align="left">Direction</th><th align="right">P&L</th><th align="right">R</th><th align="left">Discipline</th></tr></thead>
            <tbody>{[...filtered].reverse().map(trade=><tr key={trade.id}>
              <td>{new Date(trade.closedAt).toLocaleString()}</td>
              <td>{trade.instrument}</td>
              <td>{trade.strategy}</td>
              <td>{trade.session}</td>
              <td>{trade.direction}</td>
              <td align="right" className={trade.pnl>=0?'positive':'negative'}>{money(trade.pnl,account.currency)}</td>
              <td align="right">{trade.r.toFixed(2)}R</td>
              <td>{trade.compliant?'Compliant':'Override'}</td>
            </tr>)}</tbody>
          </table>
        </div>
      ):<p className="muted">No closed trades in this period.</p>}
    </section>
  </div>;
}
function EquityChart({startingBalance,currency,points,drawdown}:{startingBalance:number;currency:string;points:{label:string;value:number}[];drawdown:{label:string;value:number}[]}){
  if(!points.length)return <div className="card empty-state"><strong>No closed trades in this period.</strong><span>The equity curve will populate from realized P&L.</span></div>;
  const values=[startingBalance,...points.map(point=>point.value)];
  const min=Math.min(...values),max=Math.max(...values),span=max-min||1;
  const coords=[{label:'Start',value:startingBalance},...points]
    .map((point,index,all)=>`${(index/Math.max(1,all.length-1))*100},${92-((point.value-min)/span)*80}`)
    .join(' ');
  const end=points.at(-1)!.value;
  const maxDd=Math.max(0,...drawdown.map(point=>point.value));
  return <section className="card equity-card">
    <div className="section-title">
      <div><span className="eyebrow">EQUITY CURVE</span><h2>Actual account progression</h2><p className="muted">Starting balance plus cumulative realized P&L.</p></div>
      <div style={{textAlign:'right'}}><strong className={end>=startingBalance?'positive':'negative'}>{money(end,currency)}</strong><small style={{display:'block'}}>Max DD {maxDd.toFixed(2)}%</small></div>
    </div>
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Account equity curve">
      <line x1="0" y1="92" x2="100" y2="92"/>
      <polyline points={coords}/>
    </svg>
  </section>;
}

function Metric({label,value,sub}:{label:string;value:string;sub?:string}){
  return <div className="card metric"><span className="muted">{label}</span><strong>{value}</strong>{sub&&<small>{sub}</small>}</div>;
}

type GroupRow={name:string;pnl:number;r:number;trades:number;wins:number;winRate:number;averageR:number;profitFactor:number};

function Breakdown({title,rows,currency}:{title:string;rows:GroupRow[];currency:string}){
  return <div className="card">
    <h2>{title}</h2>
    {rows.length?rows.map(row=><div className="event-row" key={row.name}>
      <div><strong>{row.name||'Unknown'}</strong><small style={{display:'block'}}>{row.trades} trades · {row.winRate.toFixed(0)}% wins · {row.averageR.toFixed(2)}R avg</small></div>
      <span className={row.pnl>=0?'positive':'negative'}>{money(row.pnl,currency)}</span>
    </div>):<p className="muted">No closed trades in this period.</p>}
  </div>;
}

function DisciplineCard({title,row,currency}:{title:string;row:GroupRow;currency:string}){
  return <div className="card metric">
    <span className="muted">{title}</span>
    <strong className={row.pnl>=0?'positive':'negative'}>{money(row.pnl,currency)}</strong>
    <small>{row.trades} trades · {row.winRate.toFixed(1)}% wins · {row.averageR.toFixed(2)}R average</small>
  </div>;
}

function filterRange(trades:Trade[],range:Range){
  if(range==='ALL')return trades;
  const days=range==='1D'?1:range==='7D'?7:range==='30D'?30:range==='3M'?90:365;
  const cutoff=Date.now()-days*86_400_000;
  return trades.filter(trade=>new Date(trade.closedAt).getTime()>=cutoff);
}

function calculateAnalytics(trades:Trade[],startingBalance:number){
  const ordered=[...trades].sort((a,b)=>+new Date(a.closedAt)-+new Date(b.closedAt));
  let equity=startingBalance;
  let peak=startingBalance;
  let maxDrawdown=0;
  let maxDrawdownPercent=0;
  const curve=ordered.map(trade=>{
    equity+=trade.pnl;
    peak=Math.max(peak,equity);
    const drawdown=Math.max(0,peak-equity);
    const drawdownPercent=peak?drawdown/peak*100:0;
    maxDrawdown=Math.max(maxDrawdown,drawdown);
    maxDrawdownPercent=Math.max(maxDrawdownPercent,drawdownPercent);
    return {label:new Date(trade.closedAt).toLocaleString(),value:equity};
  });
  let runningPeak=startingBalance;
  const drawdownCurve=curve.map(point=>{
    runningPeak=Math.max(runningPeak,point.value);
    return {label:point.label,value:runningPeak?Math.max(0,(runningPeak-point.value)/runningPeak*100):0};
  });

  const wins=ordered.filter(trade=>trade.pnl>0);
  const losses=ordered.filter(trade=>trade.pnl<0);
  const grossProfit=wins.reduce((sum,trade)=>sum+trade.pnl,0);
  const grossLoss=Math.abs(losses.reduce((sum,trade)=>sum+trade.pnl,0));
  const pnl=ordered.reduce((sum,trade)=>sum+trade.pnl,0);
  const averageR=ordered.length?ordered.reduce((sum,trade)=>sum+trade.r,0)/ordered.length:0;
  const winRate=ordered.length?wins.length/ordered.length*100:0;
  const averageWin=wins.length?grossProfit/wins.length:0;
  const averageLoss=losses.length?grossLoss/losses.length:0;
  const averageWinR=wins.length?wins.reduce((sum,trade)=>sum+trade.r,0)/wins.length:0;
  const averageLossR=losses.length?Math.abs(losses.reduce((sum,trade)=>sum+trade.r,0)/losses.length):0;
  const expectancy=(winRate/100)*averageWinR-(1-winRate/100)*averageLossR;

  const compliant=groupRows(ordered.filter(trade=>trade.compliant),()=> 'Compliant')[0]??emptyGroup('Compliant');
  const override=groupRows(ordered.filter(trade=>!trade.compliant),()=> 'Override')[0]??emptyGroup('Override');

  return {
    curve,drawdownCurve,pnl,averageR,winRate,expectancy,
    wins:wins.length,losses:losses.length,
    profitFactor:grossLoss?grossProfit/grossLoss:(grossProfit?Infinity:0),
    averageWin,averageLoss,maxDrawdown,maxDrawdownPercent,
    best:[...ordered].sort((a,b)=>b.pnl-a.pnl)[0],
    worst:[...ordered].sort((a,b)=>a.pnl-b.pnl)[0],
    longestWinStreak:streak(ordered,trade=>trade.pnl>0),
    longestLossStreak:streak(ordered,trade=>trade.pnl<0),
    byHour:groupRows(ordered,trade=>`${String(new Date(trade.openedAt).getHours()).padStart(2,'0')}:00`),
    byWeekday:groupRows(ordered,trade=>['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date(trade.openedAt).getDay()]),
    bySession:groupRows(ordered,trade=>trade.session||'Unknown'),
    byInstrument:groupRows(ordered,trade=>trade.instrument),
    byStrategy:groupRows(ordered,trade=>trade.strategy),
    byDirection:groupRows(ordered,trade=>trade.direction),
    compliance:{
      compliant,override,
      message:override.trades===0
        ? 'No override trades were recorded in this period.'
        : compliant.averageR>override.averageR
          ? `Following the strategy produced ${(compliant.averageR-override.averageR).toFixed(2)}R more per trade than overrides.`
          : `Overrides produced ${(override.averageR-compliant.averageR).toFixed(2)}R more per trade in this sample. Review trade count before drawing conclusions.`,
    },
  };
}

function groupRows(trades:Trade[],key:(trade:Trade)=>string):GroupRow[]{
  const map=new Map<string,Trade[]>();
  for(const trade of trades){
    const name=key(trade)||'Unknown';
    map.set(name,[...(map.get(name)??[]),trade]);
  }
  return [...map.entries()].map(([name,items])=>{
    const wins=items.filter(item=>item.pnl>0);
    const grossProfit=wins.reduce((sum,item)=>sum+item.pnl,0);
    const grossLoss=Math.abs(items.filter(item=>item.pnl<0).reduce((sum,item)=>sum+item.pnl,0));
    return {
      name,
      pnl:items.reduce((sum,item)=>sum+item.pnl,0),
      r:items.reduce((sum,item)=>sum+item.r,0),
      trades:items.length,
      wins:wins.length,
      winRate:items.length?wins.length/items.length*100:0,
      averageR:items.length?items.reduce((sum,item)=>sum+item.r,0)/items.length:0,
      profitFactor:grossLoss?grossProfit/grossLoss:(grossProfit?Infinity:0),
    };
  }).sort((a,b)=>b.pnl-a.pnl);
}

function emptyGroup(name:string):GroupRow{
  return {name,pnl:0,r:0,trades:0,wins:0,winRate:0,averageR:0,profitFactor:0};
}

function streak(trades:Trade[],predicate:(trade:Trade)=>boolean){
  let best=0,current=0;
  for(const trade of trades){
    current=predicate(trade)?current+1:0;
    best=Math.max(best,current);
  }
  return best;
}

function money(value:number,currency:string){
  return new Intl.NumberFormat(undefined,{style:'currency',currency:currency||'USD',maximumFractionDigits:2}).format(value);
}

function tradeLabel(trade:Trade){
  return `${trade.instrument} · ${trade.strategy} · ${new Date(trade.closedAt).toLocaleDateString()}`;
}
