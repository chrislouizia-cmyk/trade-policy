import { notFound } from 'next/navigation';
import LifecycleTestHarness from '@/components/admin/LifecycleTestHarness';
import { getHQContext } from '@/lib/hq-page';
import { createClient } from '@/lib/supabase/server';

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
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const accountRows = user
    ? await supabase
        .from('trading_accounts')
        .select('id,name,current_balance,is_active,is_archived,account_type,currency')
        .eq('user_id', user.id)
        .eq('is_archived', false)
        .order('is_active', { ascending: false })
        .order('created_at', { ascending: false })
    : { data: [] as Array<Record<string, unknown>> };

  const accounts = (accountRows.data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name ?? 'Trading Account'),
    currency: String(row.currency ?? 'USD'),
    accountType: String(row.account_type ?? 'PAPER'),
    currentBalance: Number(row.current_balance ?? 0),
    isActive: Boolean(row.is_active),
    isArchived: Boolean(row.is_archived),
  }));

  return <LifecycleTestHarness role={String(role)} accounts={accounts} />;
}
