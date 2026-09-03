import type {Locale} from '@/lib/i18n/config';
import {workspaceText} from '@/lib/i18n/workspace-copy';

export default function OnboardingChecklist({hasAccount,hasStrategy,hasTrade,locale}:{hasAccount:boolean;hasStrategy:boolean;hasTrade:boolean;locale:Locale}){
 const w=(text:string)=>workspaceText(locale,text);
 const steps=[
  {id:'account',label:w('Add a risk account'),href:'/accounts',done:hasAccount,description:w('Create an account and add a balance so the risk checks have a real starting point.')},
  {id:'rules',label:w('Use starter rules'),href:'/profile?quickstart=1',done:hasStrategy,description:w('Load the guided starter playbook, then review and save it as your own.')},
  {id:'analysis',label:w('Run your first analysis'),href:'/validate',done:hasTrade,description:w('Check one setup and follow the walkthrough to the first decision.')},
 ] as const;
 const done=steps.filter(step=>step.done).length;
 const progress=Math.round((done/steps.length)*100);
 if(done===steps.length)return null;
 return <section className="card onboarding activation-shell" aria-labelledby="activation-checklist-title"><div className="activation-copy"><p className="muted">{w('ACTIVATION CHECKLIST')}</p><h2 id="activation-checklist-title">{w('Turn setup into your first trusted decision')}</h2><p>{w('Each step is designed to move you from account setup to a first market read in under three minutes.')}</p><div className="activation-progress" aria-hidden="true"><span>{progress}% {w('complete')}</span><div className="activation-progress-track"><span style={{width:`${progress}%`}} /></div></div></div><div className="activation-content"><div className="onboarding-steps">{steps.map((step,index)=><a key={step.id} href={step.href} className={`activation-step-card${step.done?' done':''}`} aria-current={step.done?'page':undefined}><span>{index+1}</span><div><strong>{step.label}</strong><small>{step.description}</small></div></a>)}</div><details className="activation-help-card"><summary>{w('Help center · common questions')}</summary><ul className="activation-help-list"><li><strong>{w('What if I only want the starter rules?')}</strong><br/>{w('That is the fastest route. Review them once, then save them as your own playbook.')}</li><li><strong>{w('Do I need a live market read first?')}</strong><br/>{w('No, but a live read gives the clearest first walkthrough and helps you learn the decision flow.')}</li><li><strong>{w('Can I come back later?')}</strong><br/>{w('Yes. The checklist stays on the dashboard until every step is complete.')}</li></ul></details></div></section>
}
