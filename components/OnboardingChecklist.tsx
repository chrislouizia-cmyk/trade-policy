export default function OnboardingChecklist({hasAccount,hasStrategy,hasTrade}:{hasAccount:boolean;hasStrategy:boolean;hasTrade:boolean}){
 const done=[hasAccount,hasStrategy,hasTrade].filter(Boolean).length;
 if(done===3)return null;
 return <div className="card onboarding"><div><p className="muted">WELCOME TO TRADE POLICE</p><h2>Complete your setup</h2><p>{done}/3 steps complete</p></div><div className="onboarding-steps"><a href="/accounts" className={hasAccount?'done':''}>1. Create trading account</a><a href="/profile" className={hasStrategy?'done':''}>2. Build or activate strategy</a><a href="/validate" className={hasTrade?'done':''}>3. Analyze your first trade</a></div></div>
}
