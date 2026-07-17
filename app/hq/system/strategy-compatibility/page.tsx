import StrategyCompatibilityInspector from '@/components/hq/StrategyCompatibilityInspector';
import SystemOperationsNav from '@/components/hq/SystemOperationsNav';
import {getHQContext,HQShell} from '@/lib/hq-page';

export default async function Page({searchParams}:{searchParams:Promise<{strategyId?:string}>}){
  const {strategyId=''}=await searchParams;
  const {role,displayName,permissions}=await getHQContext('system.health');
  return <HQShell displayName={displayName} role={role} permissions={permissions}>
    <div className="stack operations-v2">
      <header className="hq-section-heading"><div><span className="eyebrow">SYSTEM OPERATIONS</span><h1>Strategy Compatibility Inspector</h1><p>Search accessible strategies and run the existing least-privilege compatibility diagnostic.</p></div></header>
      <SystemOperationsNav active="compatibility"/>
      <StrategyCompatibilityInspector initialStrategyId={strategyId}/>
    </div>
  </HQShell>;
}
