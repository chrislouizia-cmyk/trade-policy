'use client';

import type { AIBehaviorProfile, StrategyProfile } from '@/types/trade';

const DEFAULT_AI:AIBehaviorProfile={tone:'analytical',strictness:'conservative',confidenceThreshold:80,explainDecisions:true,suggestAlternatives:true,useDisplayName:true};

export default function StrategyPersonalization({profile,onChange}:{profile:StrategyProfile;onChange:(profile:StrategyProfile)=>void}){
  const ai=profile.aiBehavior??DEFAULT_AI;
  return <div className="stack">
    <div className="card inset-card">
      <h3>AI behavior</h3>
      <p className="muted">These settings change deterministic confidence eligibility and how Trade Police explains the structured result.</p>
      <div className="grid grid-3">
        <label>Tone<select value={ai.tone} onChange={event=>onChange({...profile,aiBehavior:{...ai,tone:event.target.value as AIBehaviorProfile['tone']}})}><option value="direct">Direct</option><option value="educational">Educational</option><option value="analytical">Analytical</option><option value="mentor">Mentor</option></select></label>
        <label>Minimum confidence<input type="number" min="0" max="100" value={ai.confidenceThreshold} onChange={event=>onChange({...profile,aiBehavior:{...ai,confidenceThreshold:Number(event.target.value)}})}/></label>
      </div>
      <div className="grid grid-3">
        <label className="check-row"><input type="checkbox" checked={ai.explainDecisions} onChange={event=>onChange({...profile,aiBehavior:{...ai,explainDecisions:event.target.checked}})}/><span>Explain every decision</span></label>
        <label className="check-row"><input type="checkbox" checked={ai.suggestAlternatives} onChange={event=>onChange({...profile,aiBehavior:{...ai,suggestAlternatives:event.target.checked}})}/><span>Suggest compliant alternatives</span></label>
        <label className="check-row"><input type="checkbox" checked={ai.useDisplayName} onChange={event=>onChange({...profile,aiBehavior:{...ai,useDisplayName:event.target.checked}})}/><span>Use my display name sparingly</span></label>
      </div>
      <p className="muted">Methodology libraries, personal timing rules, holding-time policies, and AI strictness are coming later.</p>
    </div>
  </div>;
}
