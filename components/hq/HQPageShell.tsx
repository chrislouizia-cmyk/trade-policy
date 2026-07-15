import HQHeader from '@/components/hq/HQHeader';
export default function HQPageShell({displayName,role,permissions,children}:{displayName:string;role:string;permissions:string[];children:React.ReactNode}){
  return <main className="container hq-container"><HQHeader displayName={displayName} role={role} permissions={permissions}/><div className="hq-page-content">{children}</div></main>;
}
