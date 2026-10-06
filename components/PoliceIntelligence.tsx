import type { LearningDimension, LearningSummary } from "@/lib/trader-learning";
import type { Locale } from "@/lib/i18n/config";

const copy = {
  en: { eyebrow:"POLICE INTELLIGENCE",title:"Trade Police is learning how you trade",early:"Early learning",established:"Established profile",noTrades:"Learning has started. Close recorded trades to unlock patterns by hour, day, market and strategy.",automatic:"Updates automatically from recorded activity. Times use",trades:"closed trades",average:"average",decisions:"decisions analyzed",activeDays:"active days",strongest:"Strongest observed",weakest:"Needs review",recommendations:"Current coaching",sample:"trades" },
  es: { eyebrow:"INTELIGENCIA POLICIAL",title:"Trade Police está aprendiendo cómo operas",early:"Aprendizaje inicial",established:"Perfil establecido",noTrades:"El aprendizaje ya comenzó. Cierra operaciones registradas para descubrir patrones por hora, día, mercado y estrategia.",automatic:"Se actualiza automáticamente con la actividad registrada. Las horas usan",trades:"operaciones cerradas",average:"promedio",decisions:"decisiones analizadas",activeDays:"días activos",strongest:"Mejor patrón observado",weakest:"Requiere revisión",recommendations:"Orientación actual",sample:"operaciones" },
  fr: { eyebrow:"INTELLIGENCE POLICIÈRE",title:"Trade Police apprend votre façon de trader",early:"Apprentissage initial",established:"Profil établi",noTrades:"L’apprentissage a commencé. Clôturez des trades enregistrés pour révéler les tendances par heure, jour, marché et stratégie.",automatic:"Mise à jour automatique depuis l’activité enregistrée. Les heures utilisent",trades:"trades clôturés",average:"moyenne",decisions:"décisions analysées",activeDays:"jours actifs",strongest:"Meilleur profil observé",weakest:"À examiner",recommendations:"Coaching actuel",sample:"trades" },
} as const;

export default function PoliceIntelligence({summary,locale,full=false}:{summary:LearningSummary;locale:Locale;full?:boolean}) {
  const c=copy[locale]??copy.en;
  const eligible=summary.dimensions.filter(item=>item.trades>=3);
  const strongest=[...eligible].sort((a,b)=>b.averageR-a.averageR)[0];
  const weakest=[...eligible].sort((a,b)=>a.averageR-b.averageR)[0];
  const established=summary.closedTrades>=30;
  return <section className="card police-intelligence" aria-labelledby="police-intelligence-title">
    <header className="police-intelligence-head"><div><span className="eyebrow">{c.eyebrow}</span><h2 id="police-intelligence-title">{c.title}</h2></div><span className={"status-pill "+(established?"healthy":"warning")}>{established?c.established:c.early}</span></header>
    {summary.closedTrades===0?<p>{c.noTrades}</p>:<>
      <div className="police-intelligence-metrics"><Metric value={String(summary.closedTrades)} label={c.trades}/><Metric value={summary.averageR===null?"—":(summary.averageR>=0?"+":"")+summary.averageR+"R"} label={c.average}/><Metric value={String(summary.behavior.decisions)} label={c.decisions}/><Metric value={String(summary.behavior.activeDays)} label={c.activeDays}/></div>
      {(strongest||weakest)&&<div className="police-intelligence-patterns">{strongest&&<Pattern title={c.strongest} item={strongest} tone="positive" sample={c.sample}/>} {weakest&&<Pattern title={c.weakest} item={weakest} tone="negative" sample={c.sample}/>}</div>}
      {summary.recommendations.length>0&&<div className="police-intelligence-coaching"><h3>{c.recommendations}</h3>{summary.recommendations.slice(0,full?6:3).map(item=><article key={item.id}><span className={"badge "+(item.priority==="HIGH"?"rejected":"review")}>{item.priority}</span><div><strong>{item.title}</strong><p>{item.detail}</p></div></article>)}</div>}
    </>}
    {full&&<DimensionTable dimensions={summary.dimensions} sample={c.sample}/>}
    <small className="muted">{c.automatic} {summary.timezone}. · {new Date(summary.generatedAt).toLocaleString(locale)}</small>
  </section>;
}
function Metric({value,label}:{value:string;label:string}){return <div><strong>{value}</strong><span>{label}</span></div>}
function Pattern({title,item,tone,sample}:{title:string;item:LearningDimension;tone:"positive"|"negative";sample:string}){return <article className={tone}><span>{title}</span><strong>{item.label}</strong><small>{item.averageR>=0?"+":""}{item.averageR}R · {item.trades} {sample}</small></article>}
function DimensionTable({dimensions,sample}:{dimensions:LearningDimension[];sample:string}) {
  if(!dimensions.length)return null;
  return <details className="police-intelligence-details"><summary>Evidence map</summary><div>{[...dimensions].sort((a,b)=>a.dimension.localeCompare(b.dimension)||b.averageR-a.averageR).map(item=><p key={item.dimension+":"+item.key}><span>{item.dimension} · {item.label}</span><strong>{item.averageR>=0?"+":""}{item.averageR}R</strong><small>{item.trades} {sample} · {item.winRate}%</small></p>)}</div></details>;
}

