import type {ObservedTraderProfile} from '@/lib/trader-profile-metrics';

type Props={declaredType:string|null;experienceLevel:string|null;observed:ObservedTraderProfile};
const points=[[100,18],[178,75],[148,164],[52,164],[22,75]] as const;
const center=[100,100] as const;

function polygon(values:readonly (number|null)[]){
  return values.map((value,index)=>{
    const ratio=Math.max(0,Math.min(100,value??0))/100;
    const [x,y]=points[index];
    return `${center[0]+(x-center[0])*ratio},${center[1]+(y-center[1])*ratio}`;
  }).join(' ');
}

export default function TraderProfileOverview({declaredType,experienceLevel,observed}:Props){
  const unlocked=observed.confidence!=='INSUFFICIENT';
  const chartReady=unlocked&&observed.metrics.every(metric=>metric.value!==null);
  const title=unlocked&&observed.observedType?observed.observedType:declaredType||'Trader profile';
  return <section className="card trader-profile-overview">
    <header className="trader-profile-heading">
      <div><p className="eyebrow">TRADER PROFILE</p><h2>{title}</h2><p className="muted">{experienceLevel||'Experience level not set'} · {declaredType||'Trading style not set'}</p></div>
      <span className="status-pill">{observed.sampleSize} closed trade{observed.sampleSize===1?'':'s'}</span>
    </header>
    <div className="trader-profile-content">
      <div className={`trader-profile-radar ${chartReady?'':'is-locked'}`}>
        <svg viewBox="0 0 200 190" role="img" aria-label={chartReady?'Observed trader profile radar':'Observed trader profile needs more reviewed trades'}>
          {[1,.75,.5,.25].map(scale=><polygon key={scale} points={points.map(([x,y])=>`${center[0]+(x-center[0])*scale},${center[1]+(y-center[1])*scale}`).join(' ')} fill="none" stroke="currentColor" strokeOpacity=".16" />)}
          {points.map(([x,y],index)=><line key={index} x1={center[0]} y1={center[1]} x2={x} y2={y} stroke="currentColor" strokeOpacity=".14" />)}
          {chartReady?<polygon points={polygon(observed.metrics.map(metric=>metric.value))} fill="rgba(92,215,181,.18)" stroke="#65ddbb" strokeWidth="2" />:null}
        </svg>
      </div>
      <div className="trader-profile-evidence">
        <h3>{unlocked?'Observed from your trading history':'Your observed profile is still forming'}</h3>
        <p className="muted">{unlocked
          ?`${observed.confidence==='ESTABLISHED'?'Established':'Early'} profile${observed.averageHoldMinutes===null?'':` · average hold ${observed.averageHoldMinutes} minutes`}. These scores describe recorded behavior; they do not predict performance.`
          :`Close at least 5 executed trades to unlock behavior scores. Until then, Trade Police uses the experience and style you selected.`}</p>
        <dl className="trader-profile-metrics">
          {observed.metrics.map(metric=><div key={metric.key} title={metric.detail}><dt>{metric.label}</dt><dd>{unlocked&&metric.value!==null?`${metric.value}%`:'—'}</dd></div>)}
        </dl>
      </div>
    </div>
  </section>;
}
