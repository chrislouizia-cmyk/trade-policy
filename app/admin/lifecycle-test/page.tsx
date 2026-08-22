import { notFound } from 'next/navigation';
import LifecycleTestHarness from '@/components/admin/LifecycleTestHarness';
import { getHQContext } from '@/lib/hq-page';

function simulationEnabled(): boolean {
  const value = process.env.TRADE_LIFECYCLE_V2_SIMULATION ?? process.env.NEXT_PUBLIC_TRADE_LIFECYCLE_V2_SIMULATION;
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['1', 'true', 'enabled', 'on'].includes(normalized);
}

export default async function LifecycleTestPage() {
  if (!simulationEnabled()) {
    notFound();
  }

  const { role } = await getHQContext('system.health');
  return <LifecycleTestHarness role={String(role)} />;
}
