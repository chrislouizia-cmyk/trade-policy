'use client';

import { buildMethodologyVerification } from '@/lib/methodology-verification';
import type { StrategyProfile, StrategyRule } from '@/types/trade';

export default function MethodologyVerification({profile,rules,onAccept,onRefine}:{profile:StrategyProfile;rules:StrategyRule[];onAccept:()=>void;onRefine:()=>void}){
  const verification=buildMethodologyVerification(profile,rules);
  const tone=verification.displayVerdict==='APPROVE'?'authorized':verification.displayVerdict==='WAIT'?'wait':'rejected';
  return <section className="card methodology-verification" aria-labelledby="verification-title"><header><p className="muted">METHODOLOGY CHECK</p><h2 id="verification-title">Let me prove I understood your playbook.</h2><p>This is a realistic example generated from your saved settings. It is not live market analysis or trading advice.</p></header><div className="verification-scenario" aria-label="Generated trade scenario">{verification.scenario.map((item,index)=><div key={`${item.label}:${index}`}><span>{item.label}</span><strong>{item.value}</strong></div>)}</div><section className={`verification-decision ${tone}`}><p>According to the methodology you taught me...</p><strong>{verification.displayVerdict}</strong><h3>Why</h3><p>{verification.narrative.explanation}</p>{verification.narrative.reasons.length>0&&<ul>{verification.narrative.reasons.map(reason=><li key={reason.id}>{reason.message}</li>)}</ul>}{verification.narrative.missingEvidence.length>0&&<p className="muted">Still required: {verification.narrative.missingEvidence.map(item=>item.label).join(', ')}</p>}</section><footer><h3>Would you have taken this trade?</h3><div className="button-row"><button className="primary" type="button" onClick={onAccept}>✓ Yes</button><button type="button" onClick={onRefine}>✗ No</button></div></footer></section>;
}
