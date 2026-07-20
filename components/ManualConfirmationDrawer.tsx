'use client';

import { useEffect, useRef } from 'react';
import { manualRulePrompt, ruleLabel } from '@/lib/manual-confirmations';
import type { ManualConfirmationState, StrategyRule } from '@/types/trade';

export default function ManualConfirmationDrawer({open,rules,states,busy,onChange,onClose}:{open:boolean;rules:StrategyRule[];states:Record<string,ManualConfirmationState>;busy:boolean;onChange:(ruleKey:string,state:ManualConfirmationState)=>void;onClose:()=>void}){
  const closeRef=useRef<HTMLButtonElement>(null);
  useEffect(()=>{if(!open)return;const overflow=document.body.style.overflow;document.body.style.overflow='hidden';closeRef.current?.focus();const close=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose()};window.addEventListener('keydown',close);return()=>{document.body.style.overflow=overflow;window.removeEventListener('keydown',close)}},[open,onClose]);
  if(!open)return null;
  const pending=rules.filter(rule=>(states[rule.ruleKey]??'PENDING')==='PENDING').length;
  return <div className="manual-confirmation-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}><aside className="manual-confirmation-drawer" role="dialog" aria-modal="true" aria-labelledby="manual-confirmation-title"><header><div><p className="muted">PLAYBOOK CHECK-IN</p><h2 id="manual-confirmation-title">Complete manual confirmations</h2><p>{pending} manual {pending===1?'confirmation':'confirmations'} pending</p></div><button ref={closeRef} type="button" aria-label="Close manual confirmations" onClick={onClose}>×</button></header><div className="manual-confirmation-list">{rules.map(rule=>{const prompt=manualRulePrompt(rule),state=states[rule.ruleKey]??'PENDING';return <section key={rule.ruleKey} className="manual-confirmation-rule"><div><span className={`manual-state ${state.toLowerCase()}`}>{state==='CONFIRMED'?'Confirmed':state==='FAILED'?'Failed':'Pending'}</span><small>{rule.mandatory?'Required':'Optional'}</small></div><h3>{ruleLabel(rule.ruleKey,rule.label)}</h3><p>{prompt.question}</p><div className="manual-answer-grid">{prompt.answers.map(answer=><button type="button" className={state===answer.state?'selected':undefined} aria-pressed={state===answer.state} disabled={busy} key={answer.label} onClick={()=>onChange(rule.ruleKey,answer.state)}>{answer.label}</button>)}</div></section>})}</div><footer><p>Changes immediately rerun the deterministic playbook checks for this analysis.</p><button className="primary" type="button" onClick={onClose}>Done</button></footer></aside></div>;
}
