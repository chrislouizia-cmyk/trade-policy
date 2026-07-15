import HQHeader from '@/components/hq/HQHeader';
export default function HQPageShell({displayName,role,permissions,children}:{displayName:string;role:string;permissions:string[];children:React.ReactNode}){
  return <main className="hq-app-shell">
    <HQHeader displayName={displayName} role={role} permissions={permissions}/>
    <section className="hq-main-column">
      <header className="hq-mobile-topbar"><strong>Trade Police HQ</strong><span className="status-pill healthy">Private</span></header>
      <div className="hq-page-content">{children}</div>
    </section>
  </main>;
}
