import HQNav from '@/components/hq/HQNav';
import HQProfileMenu from '@/components/hq/HQProfileMenu';
export default function HQHeader({displayName,role,permissions}:{displayName:string;role:string;permissions:string[]}) {
  const date=new Intl.DateTimeFormat('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'}).format(new Date());
  const hour=new Date().getHours();
  const greeting=hour<12?'Good morning':hour<18?'Good afternoon':'Good evening';
  return <header className="hq-shell-header">
    <div className="hq-brand-row">
      <a href="/hq" className="hq-brand"><span className="brand-mark">TP</span><span><strong>Trade Police HQ</strong><small>Executive operations</small></span></a>
      <HQProfileMenu displayName={displayName} role={role}/>
    </div>
    <div className="hq-executive-greeting"><strong>{greeting}, {displayName}</strong><span>{role.replaceAll('_',' ')} · {date}</span></div>
    <HQNav permissions={permissions}/>
  </header>;
}
