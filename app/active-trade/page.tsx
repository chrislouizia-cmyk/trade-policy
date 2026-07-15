import ActiveTradeMonitor from '@/components/ActiveTradeMonitor';
import AppHeader from '@/components/AppHeader';
import { createClient } from '@/lib/supabase/server';
import { getUserDisplayName } from '@/lib/user-display-name';
import { redirect } from 'next/navigation';

export default async function ActiveTradePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const displayName = await getUserDisplayName(supabase, user);
  return <main className="container"><AppHeader eyebrow="TRADE POLICE / ACTIVE TRADE MONITOR" displayName={displayName} description="Manage the thesis, not the emotion." userId={user.id} /><ActiveTradeMonitor userId={user.id} /></main>;
}
