export default function OnboardingChecklist({hasAccount,hasStrategy,hasTrade}:{hasAccount:boolean;hasStrategy:boolean;hasTrade:boolean}){
 const done=[hasAccount,hasStrategy,hasTrade].filter(Boolean).length;
 if(done===3)return null;
 return <div className="card onboarding"><div><p className="muted">YOUR FIRST DECISION</p><h2>Get to a trustworthy result</h2><p>{done}/3 steps complete · about 3 minutes with the starter rules</p></div><div className="onboarding-steps"><a href="/accounts" className={hasAccount?'done':''}>1. Add balance for risk</a><a href="/profile?quickstart=1" className={hasStrategy?'done':''}>2. Use starter rules</a><a href="/validate" className={hasTrade?'done':''}>3. Check your first setup</a></div></div>
}
