'use client';

import type { IntelligenceIntervention } from '@/lib/trader-intelligence';
import { useState } from 'react';

export type PersonalIntelligencePayload = {
  authoritative: false;
  controlsVerdict: false;
  interventions: IntelligenceIntervention[];
};

export default function PersonalIntelligenceNotice({ intelligence }: { intelligence?: PersonalIntelligencePayload | null }) {
  const [hidden,setHidden]=useState<string[]>([]);
  const [saving,setSaving]=useState<string|null>(null);
  const interventions = (intelligence?.interventions ?? []).filter(item=>!item.recordId||!hidden.includes(item.recordId));
  if (!interventions.length) return null;
  const [primary, ...more] = interventions;
  async function respond(item:IntelligenceIntervention,response:'HELPFUL'|'DISMISSED'){
    if(!item.recordId)return;
    setSaving(item.recordId);
    try{
      const result=await fetch('/api/trader-intelligence/interventions/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({interventionId:item.recordId,response})});
      if(result.ok)setHidden(current=>[...current,item.recordId!]);
    }finally{setSaving(null)}
  }
  return <aside className={`personal-intelligence-notice severity-${primary.severity.toLowerCase()}`} aria-label="Personal intelligence">
    <div className="personal-intelligence-mark" aria-hidden="true">TP</div>
    <div>
      <p className="personal-intelligence-label">PERSONAL INTELLIGENCE · {primary.sampleSize} RECORDED TRADES</p>
      <strong>{primary.title}</strong>
      <p>{primary.detail}</p>
      {primary.recordId?<div className="personal-intelligence-feedback" aria-label="Was this observation useful?"><span>Was this useful?</span><button type="button" disabled={saving===primary.recordId} onClick={()=>void respond(primary,'HELPFUL')}>Yes</button><button type="button" disabled={saving===primary.recordId} onClick={()=>void respond(primary,'DISMISSED')}>Dismiss</button></div>:null}
      {more.length ? <details><summary>{more.length} additional personal pattern{more.length === 1 ? '' : 's'}</summary>{more.map(item => <div className="personal-intelligence-more" key={item.key}><strong>{item.title}</strong><p>{item.detail}</p></div>)}</details> : null}
      <small>Context only · your strategy and deterministic rules still control the verdict.</small>
    </div>
  </aside>;
}
