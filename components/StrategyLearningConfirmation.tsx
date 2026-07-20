'use client';

import { buildStrategyLearningSummary } from '@/lib/strategy-learning-summary';
import type { StrategyProfile, StrategyRule } from '@/types/trade';

export default function StrategyLearningConfirmation({profile,rules,onEdit,onConfirm}:{profile:StrategyProfile;rules:StrategyRule[];onEdit:()=>void;onConfirm:()=>void}){
  const dna=buildStrategyLearningSummary(profile,rules);
  return <section className="card methodology-confirmation" aria-labelledby="methodology-learned-title">
    <div className="methodology-confirmation-hero"><span aria-hidden="true">✓</span><div><p className="muted">PLAYBOOK SAVED</p><h2 id="methodology-learned-title">Trade Police has learned your methodology.</h2><p>Your playbook is now translated into the evidence, risk, and confirmation sequence I’ll use for every analysis.</p></div></div>
    <section className="methodology-explanation" aria-labelledby="analysis-explanation-title"><p className="muted">HERE&apos;S HOW I&apos;LL ANALYZE TRADES FOR YOU</p><h3 id="analysis-explanation-title">Here&apos;s how I&apos;ll analyze trades for you</h3>{dna.explanation.map((paragraph,index)=><p key={index}>{paragraph}</p>)}</section>
    <section aria-labelledby="trading-dna-title"><div className="section-title"><div><p className="muted">YOUR PLAYBOOK AT A GLANCE</p><h3 id="trading-dna-title">Trading DNA</h3></div></div><div className="trading-dna-grid"><DnaItem label="Market(s)" value={dna.markets}/><DnaItem label="Trading Style" value={dna.tradingStyle}/><DnaItem label="Risk Model" value={dna.riskModel}/><DnaItem label="Automatic Rules" value={dna.automaticRules.map(rule=>rule.label).join(', ')||'None'} count={dna.automaticRules.length}/><DnaItem label="Manual Confirmations" value={dna.manualRules.map(rule=>rule.label).join(', ')||'None'} count={dna.manualRules.length}/><DnaItem label="External Integrations" value={dna.externalRules.map(rule=>rule.label).join(', ')||'None'} count={dna.externalRules.length}/></div><div className="methodology-understanding"><span>✓ Automatic Understanding <strong>{dna.automaticRules.length}</strong></span><span>✓ Manual Confirmations <strong>{dna.manualRules.length}</strong></span><span className={dna.externalRules.length?'pending':'complete'}>✓ Pending External Integrations <strong>{dna.externalRules.length}</strong></span></div></section>
    <footer className="methodology-confirmation-actions"><h3>Let&apos;s verify that I understood your methodology correctly.</h3><div className="button-row"><button className="primary" type="button" onClick={onConfirm}>✓ Yes, that&apos;s exactly how I trade</button><button type="button" onClick={onEdit}>✏️ I&apos;d like to make some changes</button></div></footer>
  </section>;
}

function DnaItem({label,value,count}:{label:string;value:string;count?:number}){return <div className="card trading-dna-item"><span className="muted">{label}</span><strong>{count===undefined?value:`${count}`}</strong>{count!==undefined&&<small>{value}</small>}</div>}
