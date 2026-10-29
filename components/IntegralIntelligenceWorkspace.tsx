'use client';

import { useEffect, useState } from 'react';
import type { IntegralState, IntegralSettings } from '@/lib/trader-integral-intelligence';
import type { Locale } from '@/lib/i18n/config';

const tasks:Record<string,Record<string,string>>={
  es:{RISK_CONSISTENCY:'Revisa las siguientes cinco entradas: identifica aumentos de riesgo después de perder y registra el motivo antes de entrar.',RULE_ADHERENCE:'En las siguientes cinco operaciones, registra si seguiste el veredicto y explica cada excepción.',EVIDENCE_BASE:'Registra hora de entrada, riesgo, adherencia y cierre en las siguientes cinco operaciones.',EXECUTION_REVIEW:'Compara cinco operaciones recientes con anteriores de la misma estrategia e instrumento.',PROCESS_CONSISTENCY:'Revisa el proceso de cinco operaciones, independientemente de si ganaron o perdieron.'},
  fr:{RISK_CONSISTENCY:'Examinez les cinq prochaines entrées : notez les changements de risque après une perte.',RULE_ADHERENCE:'Pour les cinq prochains trades, notez le respect du verdict et expliquez chaque exception.',EVIDENCE_BASE:'Enregistrez l’heure, le risque, le respect des règles et la clôture des cinq prochains trades.',EXECUTION_REVIEW:'Comparez cinq trades récents avec des trades précédents de la même stratégie et du même instrument.',PROCESS_CONSISTENCY:'Examinez le processus de cinq trades, indépendamment de leur résultat.'}
};
const copy = {
  es: { title:'Inteligencia personal', intro:'Un resumen útil. La evidencia y los controles están disponibles cuando los necesitas.', weekly:'Últimos 7 días', training:'Tu siguiente prioridad', exposure:'Exposición registrada', patterns:'Contextos y cambios', reviews:'Revisiones de ejecución', lab:'Laboratorio de hipótesis', memory:'Lo que quieres que recuerde', privacy:'Privacidad y preferencias', evidence:'Ver evidencia', remove:'Eliminar', save:'Guardar', correction:'Corrección', preference:'Preferencia', note:'Nota', placeholder:'Una preferencia o corrección sobre tu forma de operar…', consent:'Participar en aprendizaje colectivo con estadísticas agregadas', consentDetail:'Opcional. No se comparten tus notas ni estrategias. Los patrones colectivos requieren al menos 20 participantes.', pending:'Actualizando con tu actividad reciente', error:'No se pudo completar. Inténtalo de nuevo.', saved:'Guardado', unknown:'Sin datos suficientes', trades:'operaciones', risk:'Riesgo registrado', stale:'cotizaciones pendientes de actualizar', account:'Cuenta', helpful:'Respuestas útiles', limits:'Alcance de la evidencia', limitsDetail:'Datos registrados en TP. Aún no verificamos resultados con un broker, correlaciones entre mercados ni noticias o spreads actuales. El contexto de mercado muestra únicamente análisis registrados con fecha. Los estudios describen asociaciones; no modifican tus reglas.', mute:'Silenciar esta observación', inspect:'Evidencia y controles', process:'Proceso', weeklyLabel:'R promedio / adherencia conocida', labDetail:'Comparación retrospectiva con registros posteriores separados. No es una prueba prospectiva ni una estrategia aprobada.', startStudy:"Iniciar estudio en observación", deleteError:'No se pudo eliminar el recuerdo.' },
  en: { title:'Personal intelligence', intro:'One useful summary. Evidence and controls are available when you need them.', weekly:'Last 7 days', training:'Your next priority', exposure:'Recorded exposure', patterns:'Contexts and changes', reviews:'Execution reviews', lab:'Hypothesis laboratory', memory:'What you want remembered', privacy:'Privacy and preferences', evidence:'View evidence', remove:'Delete', save:'Save', correction:'Correction', preference:'Preference', note:'Note', placeholder:'A preference or correction about your trading process…', consent:'Participate in collective learning with aggregate statistics', consentDetail:'Optional. Notes and strategies are not shared. Collective patterns require at least 20 contributors.', pending:'Updating from your recent activity', error:'Unable to complete. Please retry.', saved:'Saved', unknown:'Insufficient evidence', trades:'executions', risk:'Recorded risk', stale:'quotes awaiting refresh', account:'Account', helpful:'Helpful responses', limits:'Evidence coverage', limitsDetail:'Records in TP. Broker reconciliation, measured cross-market correlations and live news/spreads are not available. Market context shows dated recorded analyses only. Studies describe associations and do not modify your rules.', mute:'Mute this observation', inspect:'Evidence and controls', process:'Process', weeklyLabel:'Average R / known adherence', labDetail:'Retrospective comparison with later records held apart. This is not a prospective test or approved strategy.', startStudy:"Start shadow study", deleteError:'Memory could not be removed.' },
  fr: { title:'Intelligence personnelle', intro:'Une synthèse utile. Les preuves et contrôles restent accessibles.', weekly:'7 derniers jours', training:'Votre prochaine priorité', exposure:'Exposition enregistrée', patterns:'Contextes et changements', reviews:'Revues d’exécution', lab:'Laboratoire d’hypothèses', memory:'Ce que vous souhaitez mémoriser', privacy:'Confidentialité et préférences', evidence:'Voir les preuves', remove:'Supprimer', save:'Enregistrer', correction:'Correction', preference:'Préférence', note:'Note', placeholder:'Une préférence ou correction sur votre trading…', consent:'Participer à l’apprentissage collectif avec des statistiques agrégées', consentDetail:'Facultatif. Notes et stratégies ne sont pas partagées. Les tendances collectives nécessitent au moins 20 participants.', pending:'Mise à jour depuis votre activité récente', error:'Impossible de terminer. Réessayez.', saved:'Enregistré', unknown:'Preuves insuffisantes', trades:'exécutions', risk:'Risque enregistré', stale:'cotations à actualiser', account:'Compte', helpful:'Réponses utiles', limits:'Portée des preuves', limitsDetail:'Données enregistrées dans TP. Le rapprochement broker, les corrélations mesurées et les actualités/spreads en direct sont indisponibles. Le contexte de marché provient uniquement des analyses datées. Les études décrivent des associations et ne modifient pas vos règles.', mute:'Masquer cette observation', inspect:'Preuves et contrôles', process:'Processus', weeklyLabel:'R moyen / respect connu', labDetail:'Comparaison rétrospective avec des données ultérieures séparées. Ni test prospectif ni stratégie approuvée.', startStudy:"Démarrer une étude d’observation", deleteError:'Le souvenir n’a pas pu être supprimé.' },
};
type Memory = {id:string;category:string;content:string};
type Evidence = {id:string;instrument:string;opened_at:string|null;result_r:number|null;risk_percent:number|null;taken_against_verdict:boolean|null};

const timezoneCopy={
  es:{title:'Zona horaria de trading',hint:'Se detecta una vez por usuario. Otro dispositivo no la cambia. Puedes confirmarla o actualizarla si viajas.',save:'Guardar zona horaria',device:'Usar la zona de este dispositivo'},
  en:{title:'Trading timezone',hint:'Detected once per user. Another device does not change it. Confirm or update it when travelling.',save:'Save timezone',device:'Use this device’s timezone'},
  fr:{title:'Fuseau horaire de trading',hint:'Détecté une fois par utilisateur. Un autre appareil ne le modifie pas. Confirmez-le ou changez-le en voyage.',save:'Enregistrer le fuseau horaire',device:'Utiliser le fuseau de cet appareil'},
};

export default function IntegralIntelligenceWorkspace({initial,locale,initialTimezone}:{initial:IntegralState;locale:Locale;initialTimezone:string}){
  const c=copy[locale]??copy.en;
  const tzCopy=timezoneCopy[locale]??timezoneCopy.en;
  const [timezone,setTimezone]=useState(initialTimezone);
  const [state,setState]=useState(initial),[expanded,setExpanded]=useState(false);
  const [settings,setSettings]=useState<IntegralSettings>({collectiveOptIn:false,mutedKeys:[]});
  const [memories,setMemories]=useState<Memory[]>(initial.memory);
  const [content,setContent]=useState(''),[category,setCategory]=useState('CORRECTION');
  const [busy,setBusy]=useState(false),[status,setStatus]=useState(''),[pending,setPending]=useState(false);
  const [evidence,setEvidence]=useState<Record<string,Evidence[]>>({});
  async function reload(signal?:AbortSignal){
    const response=await fetch('/api/trader-intelligence/control',{cache:'no-store',signal});
    if(!response.ok)throw new Error('Unavailable');
    const data=await response.json();
    if(data.timezone)setTimezone(data.timezone);
    if(data.integral)setState(data.integral);
    setSettings(data.settings);setMemories(data.memories);setPending(data.pending);
  }
  useEffect(()=>{
    if(!expanded)return;
    const controller=new AbortController();
    const update=()=>{if(document.visibilityState==='visible')void reload(controller.signal).catch(()=>{if(!controller.signal.aborted)setStatus(c.error);});};
    update();const timer=window.setInterval(update,60_000);
    document.addEventListener('visibilitychange',update);
    return()=>{controller.abort();window.clearInterval(timer);document.removeEventListener('visibilitychange',update);};
  },[expanded,c.error]);
  async function mutate(method:string,body:unknown){
    if(busy)return;
    setBusy(true);setStatus('');
    try{
      const r=await fetch('/api/trader-intelligence/control',{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      if(!r.ok)throw new Error('Unavailable');
      await reload();setStatus(c.saved);if(method==='POST'&&body&&typeof body==='object'&&'content' in body)setContent('');
    }catch{setStatus(c.error);}finally{setBusy(false);}
  }
  async function inspect(key:string,ids:string[]){
    if(!ids.length)return;
    setBusy(true);
    try{
      const query=new URLSearchParams();ids.slice(-20).forEach(id=>query.append('id',id));
      const r=await fetch(`/api/trader-intelligence/evidence?${query}`,{cache:'no-store'});
      if(!r.ok)throw new Error('Unavailable');
      const data=await r.json();setEvidence(value=>({...value,[key]:data.trades}));
    }catch{setStatus(c.error);}finally{setBusy(false);}
  }
  const evidenceControl=(key:string,ids:string[])=><>{ids.length>0&&<button type="button" disabled={busy} onClick={()=>void inspect(key,ids)}>{c.evidence} · {Math.min(ids.length,20)}</button>}{evidence[key]&&<ul className="integral-evidence-list">{evidence[key].map(t=><li key={t.id}><strong>{t.instrument}</strong><span>{t.opened_at?new Date(t.opened_at).toLocaleString(locale,{timeZone:timezone}):'—'} · {t.result_r??'—'}R · {t.risk_percent??'—'}%</span></li>)}</ul>}</>;
  return <details className="integral-intelligence" onToggle={event=>setExpanded(event.currentTarget.open)}>
    <summary><span>{c.title}</span><small>{c.inspect}</small></summary>
    <div className="integral-intelligence-content">
      <p className="muted">{c.intro}</p>{pending&&<p role="status">{c.pending}</p>}
      <details><summary>{tzCopy.title} · {timezone}</summary><p>{tzCopy.hint}</p><form onSubmit={event=>{event.preventDefault();const value=new FormData(event.currentTarget).get('timezone');void mutate('POST',{timezone:value});}}><label>{tzCopy.title}<input key={timezone} name="timezone" defaultValue={timezone} required maxLength={80} placeholder="America/Monterrey" autoCapitalize="none" spellCheck={false}/></label><button type="submit" disabled={busy}>{tzCopy.save}</button><button type="button" disabled={busy} onClick={()=>void mutate('POST',{timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC'})}>{tzCopy.device}</button></form></details>
      {state.brief?.source==='OPENAI'&&<article><strong>{c.title}</strong><p>{state.brief.message}</p><small>{new Date(state.brief.generatedAt).toLocaleString(locale,{timeZone:timezone})}</small></article>}
      <section><h3>{c.training}</h3><p>{tasks[locale]?.[state.training.focus]??state.training.action}</p>{evidenceControl('training',state.training.evidenceIds)}</section>
      {state.signals.map(s=><article key={s.key}><strong>{s.title}</strong><p>{s.detail}</p>{evidenceControl(s.key,s.evidenceIds)}{s.category!=='QUALITY'&&s.category!=='EXPOSURE'&&<button type="button" disabled={busy||settings.mutedKeys.includes(s.key)} onClick={()=>void mutate('POST',{...settings,mutedKeys:[...settings.mutedKeys,s.key].slice(-30)})}>{c.mute}</button>}</article>)}
      <details><summary>{c.weekly}</summary><p>{state.weekly.trades} {c.trades} · {state.weekly.averageR??'—'}R · {state.weekly.adherenceRate??'—'}% ({state.weekly.knownAdherence})</p><small>{c.weeklyLabel}</small>{evidenceControl('weekly',state.weekly.evidenceIds)}</details>
      <details><summary>{c.exposure}</summary>{state.accounts.map(a=><article key={a.id}><strong>{a.name}</strong><p>{a.balance??'—'} {a.currency} · Drawdown {a.drawdownPercent??'—'}%</p></article>)}{state.exposure.length?state.exposure.map((row,index)=><article key={row.accountId??'unknown'}><strong>{c.account} {index+1} · {row.positions}</strong><p>{c.risk}: {row.knownRiskPercent}% · {row.staleQuotes} {c.stale}</p>{evidenceControl(`exposure-${index}`,row.evidenceIds)}</article>):<p>—</p>}</details>
      <details><summary>{c.patterns}</summary>{state.markets.map(m=><article key={m.scanId}><strong>{m.instrument} · {m.timeframe} · {m.bias}</strong><p>ATR {m.atr} · {m.freshness} · {new Date(m.calculatedAt).toLocaleString(locale,{timeZone:timezone})}</p></article>)}<p>{state.drift.baselineR??'—'}R → {state.drift.recentR??'—'}R · Δ {state.drift.changeR??'—'}R</p>{state.combinations.map(p=><article key={p.key}><strong>{p.label}</strong><p>{p.trades} {c.trades} · {p.averageR}R · {p.evidence.status}</p><small>{p.evidence.explanation}</small>{evidenceControl(p.key,p.evidenceIds)}</article>)}</details>
      <details><summary>{c.reviews}</summary>{state.reviews.map(r=><article key={r.tradeId}><strong>{r.resultR}R · {c.process}: {r.process}</strong><p>{r.interpretation}</p>{evidenceControl(r.tradeId,[r.tradeId])}</article>)}</details>
      <details><summary>{c.lab}</summary><p>{c.labDetail}</p>{state.laboratory.length?state.laboratory.map(l=><article key={l.key}><strong>{l.hypothesis}</strong><p>{l.status} · Δ {l.discoveryChangeR??'—'}R / {l.validationChangeR??'—'}R</p><button type="button" disabled={busy||state.experiments.some(e=>e.hypothesis===l.key&&e.status==='ACTIVE')} onClick={()=>void mutate('POST',{hypothesis:l.key})}>{c.startStudy}</button>{evidenceControl(l.key,l.evidenceIds)}</article>):<p>{c.unknown}</p>}{state.experiments.map(e=><article key={e.id}><strong>{e.hypothesis} · {e.status}</strong><p>{new Date(e.started_at).toLocaleString(locale,{timeZone:timezone})} · {e.evaluation.subsequentTrades} {c.trades} · Δ {e.evaluation.changeR??'—'}R</p><p>{e.evaluation.interpretation}</p>{evidenceControl(e.id,e.evaluation.evidenceIds)}</article>)}</details>
      <details><summary>{c.memory}</summary><form onSubmit={event=>{event.preventDefault();void mutate('POST',{category,content});}}><label>{c.memory}<textarea value={content} maxLength={1000} required placeholder={c.placeholder} onChange={event=>setContent(event.target.value)}/></label><label>{c.process}<select value={category} onChange={event=>setCategory(event.target.value)}><option value="CORRECTION">{c.correction}</option><option value="PREFERENCE">{c.preference}</option><option value="NOTE">{c.note}</option></select></label><button type="submit" disabled={busy}>{c.save}</button></form>{memories.map(m=><article key={m.id}><p>{m.content}</p><button type="button" disabled={busy} onClick={()=>void mutate('DELETE',{memoryId:m.id})}>{c.remove}</button></article>)}</details>
      <details><summary>{c.privacy}</summary><label className="integral-consent"><input type="checkbox" checked={settings.collectiveOptIn} disabled={busy} onChange={event=>void mutate('POST',{...settings,collectiveOptIn:event.target.checked})}/><span>{c.consent}</span></label><p>{c.consentDetail}</p>{state.collectiveHypotheses.map(h=><article key={`${h.dimension}:${h.bucket}`}><strong>{h.dimension} · {h.bucket}</strong><p>{h.contributors} · {h.trades} {c.trades} · {h.averageR}R</p><small>Aggregate hypothesis · {c.unknown}</small></article>)}{settings.mutedKeys.length>0&&<button type="button" disabled={busy} onClick={()=>void mutate('POST',{...settings,mutedKeys:[]})}>{c.save} · {settings.mutedKeys.length} → 0</button>}<p>{c.helpful}: {state.feedback.helpful}/{state.feedback.responses}</p></details>
      <details><summary>{c.limits}</summary><p>{c.limitsDetail}</p><p>Net R: {state.resultBasis.netRecorded} · {c.unknown}: {state.resultBasis.feeImpactUnknown}</p><p>{state.quality.historyLimit} · {new Date(state.generatedAt).toLocaleString(locale,{timeZone:timezone})}</p></details>
      <p role="status" aria-live="polite">{status}</p>
    </div>
  </details>;
}
