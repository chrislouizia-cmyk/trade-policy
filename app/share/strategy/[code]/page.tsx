import { notFound, redirect } from 'next/navigation';

import AppHeader from '@/components/AppHeader';
import SharedStrategyInstall from '@/components/SharedStrategyInstall';
import { createClient } from '@/lib/supabase/server';
import { getUserDisplayName } from '@/lib/user-display-name';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function SharedStrategyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!UUID.test(code)) notFound();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/share/strategy/${code}`)}`);

  const displayName = await getUserDisplayName(supabase, user);
  return <main className="container builder-container">
    <AppHeader eyebrow="TRADE POLICE / SHARED STRATEGY" displayName={displayName} description="Review the strategy and its license before adding a private copy." userId={user.id} />
    <SharedStrategyInstall code={code} />
  </main>;
}
