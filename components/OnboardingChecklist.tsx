import type {Locale} from '@/lib/i18n/config';
import {workspaceText} from '@/lib/i18n/workspace-copy';

export default function OnboardingChecklist({hasAccount,hasStrategy,hasTrade,locale}:{hasAccount:boolean;hasStrategy:boolean;hasTrade:boolean;locale:Locale}){
 const w=(text:string)=>workspaceText(locale,text);
 const steps=[
  {id:'account',label:w('Add your trading account'),href:'/accounts',done:hasAccount,description:w('Enter the balance Trade Police should use to calculate risk.')},
  {id:'rules',label:w('Choose your strategy'),href:'/profile?quickstart=1',done:hasStrategy,description:w('Use starter rules or save the rules you already trade.')},
  {id:'analysis',label:w('Check your first trade'),href:'/validate',done:hasTrade,description:w('Pick a market and follow the single next step on screen.')},
 ] as const;
 const done=steps.filter(step=>step.done).length;
 const progress=Math.round((done/steps.length)*100);
 if(done===steps.length)return null;
 return <section className="card onboarding activation-shell" aria-labelledby="activation-checklist-title"><div className="activation-copy"><p className="muted">{w('GET STARTED')}</p><h2 id="activation-checklist-title">{w('Three steps. Then Trade Police guides you.')}</h2><p>{w('Complete these once. After that, checking a trade takes one clear path.')}</p><div className="activation-progress" aria-hidden="true"><span>{progress}% {w('complete')}</span><div className="activation-progress-track"><span style={{width:`${progress}%`}} /></div></div></div><div className="activation-content"><div className="onboarding-steps">{steps.map((step,index)=><a key={step.id} href={step.href} className={`activation-step-card${step.done?' done':''}`} aria-current={step.done?'page':undefined}><span>{step.done?'✓':index+1}</span><div><strong>{step.label}</strong><small>{step.description}</small></div></a>)}</div><details className="activation-help-card"><summary>{w('Need help?')}</summary><ul className="activation-help-list"><li><strong>{w('Start with the starter strategy.')}</strong><br/>{w('You can replace it with your own rules later.')}</li><li><strong>{w('Trade Police never places the trade for you.')}</strong><br/>{w('It checks your plan and shows the next safe action.')}</li></ul></details></div></section>
}
