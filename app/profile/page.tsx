import StrategyBuilder from '@/components/StrategyBuilder';
import AppHeader from '@/components/AppHeader';
import { createClient } from '@/lib/supabase/server';
import { getUserDisplayName } from '@/lib/user-display-name';
import { redirect } from 'next/navigation';

export default async function ProfilePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const displayName = await getUserDisplayName(supabase, user);
  return <main className="container builder-container"><AppHeader eyebrow="TRADE POLICE / YOUR PLAYBOOK" displayName={displayName} description="Teach Trade Police How You Trade" userId={user.id} /><StrategyBuilder userId={user.id} /></main>;
}
