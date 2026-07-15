import { getHQContext, HQShell } from '@/lib/hq-page';
const principles=[
 ['Mission','Trade Police exists to protect disciplined traders by helping them execute their own strategy consistently.'],
 ['First principle','Trade Police will never grow by adding random features. It will grow by becoming better at protecting disciplined traders.'],
 ['Evidence before execution','No trade earns authorization without evidence from the trader’s chosen rules, risk limits and market context.'],
 ['Process over luck','A disciplined loss is better than an undisciplined win. The platform rewards process, not accidental outcomes.'],
 ['Explain every decision','Every authorization, wait state, rejection and management recommendation must explain why.'],
 ['Protect customer privacy','Strategies, screenshots, notes and trading history belong to the customer and remain outside routine staff access.'],
 ['Nothing ships until it feels complete','Complete means reliable, understandable, beautiful, secure, fast and tested.'],
 ["The founder's standard","We cannot sell something we would not buy. Every release must be worthy of a professional trader’s trust."],
];
export default async function Page(){const {role,displayName,permissions}=await getHQContext('hq.view');return <HQShell displayName={displayName} role={role} permissions={permissions}><article className="card constitution expanded-constitution"><span className="eyebrow">TRADE POLICE CONSTITUTION · VERSION 1.0</span><h1>Protect disciplined traders.</h1><p className="constitution-lead">The market is uncertain. The trader’s process does not have to be. Trade Police exists to make disciplined execution clear, auditable and repeatable.</p><blockquote>No trade without evidence.</blockquote><div className="constitution-principles">{principles.map(([title,text],index)=><section key={title}><span>{String(index+1).padStart(2,'0')}</span><div><h2>{title}</h2><p>{text}</p></div></section>)}</div></article></HQShell>}
