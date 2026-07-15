import SignOutButton from '@/components/SignOutButton';
import HQNav from '@/components/hq/HQNav';
export default function HQHeader({displayName,role,permissions}:{displayName:string;role:string;permissions:string[]}) {
  return <header className="hq-shell-header">
    <div className="hq-brand-row">
      <a href="/hq" className="hq-brand"><span className="brand-mark">TP</span><span><strong>Trade Police HQ</strong><small>Private company workspace</small></span></a>
      <div className="hq-user-context"><span className="status-pill healthy">{role.replaceAll('_',' ')}</span><span>{displayName}</span><SignOutButton /></div>
    </div>
    <HQNav permissions={permissions}/>
  </header>;
}
