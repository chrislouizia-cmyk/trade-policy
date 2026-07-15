import TradeValidator from '@/components/TradeValidator';
import AppHeader from '@/components/AppHeader';
import { createClient } from '@/lib/supabase/server';
import { getUserDisplayName } from '@/lib/user-display-name';
import { redirect } from 'next/navigation';

export default async function ValidatePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const displayName = await getUserDisplayName(supabase, user);
  return <main className="container"><AppHeader eyebrow="TRADE POLICE / VALIDATION DESK" displayName={displayName} description="Request authorization before executing a trade." userId={user.id} /><TradeValidator userId={user.id} /></main>;
}
