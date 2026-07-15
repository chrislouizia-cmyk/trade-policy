import TradingAccounts from '@/components/TradingAccounts';
import AppHeader from '@/components/AppHeader';
import { createClient } from '@/lib/supabase/server';
import { getUserDisplayName } from '@/lib/user-display-name';
import { redirect } from 'next/navigation';

export default async function AccountsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const displayName = await getUserDisplayName(supabase, user);
  return <main className="container builder-container"><AppHeader eyebrow="TRADE POLICE / ACCOUNTS" displayName={displayName} description="Every closed trade flows through an auditable account ledger." userId={user.id} /><TradingAccounts userId={user.id} /></main>;
}
