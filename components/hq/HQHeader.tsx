import SignOutButton from '@/components/SignOutButton';
import HQNav from '@/components/hq/HQNav';

export default function HQHeader({displayName,role,permissions}:{displayName:string;role:string;permissions:string[]}) {
  return <aside className="hq-sidebar">
    <a href="/hq" className="hq-brand-premium">
      <span className="hq-brand-shield">TP</span>
      <span><strong>Trade Police HQ</strong><small>Company operating center</small></span>
    </a>

    <HQNav permissions={permissions}/>

    <div className="hq-sidebar-footer">
      <div className="hq-owner-card">
        <span className="hq-avatar">{displayName.slice(0,1).toUpperCase()}</span>
        <span><strong>{displayName}</strong><small>{role.replaceAll('_',' ')}</small></span>
      </div>
      <SignOutButton />
    </div>
  </aside>;
}
