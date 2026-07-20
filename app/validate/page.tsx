import TradeValidator from '@/components/TradeValidator';
import AppHeader from '@/components/AppHeader';
import { createClient } from '@/lib/supabase/server';
import { getUserDisplayName } from '@/lib/user-display-name';
import { redirect } from 'next/navigation';
import { loadActiveStrategy, NoActiveStrategyError } from '@/lib/server/active-strategy';
import { StrategyConfigurationError } from '@/lib/strategy-policy';

export default async function ValidatePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const displayName = await getUserDisplayName(supabase, user);
  let strategy;
  try {
    strategy = await loadActiveStrategy(supabase, user.id);
  } catch (error) {
    if (!(error instanceof NoActiveStrategyError)&&!(error instanceof StrategyConfigurationError)) throw error;
    return <main className="container"><AppHeader eyebrow="TRADE POLICE / DECISION" displayName={displayName} description="Should you risk your money right now?" userId={user.id} /><div className="card empty-state"><h2>{error instanceof NoActiveStrategyError?'No active strategy':'Active strategy needs configuration'}</h2><p className="muted">{error.message}</p><a className="button-link primary" href="/profile">Build or configure strategy</a></div></main>;
  }
  return <main className="container"><AppHeader eyebrow="TRADE POLICE / DECISION" displayName={displayName} description="Should you risk your money right now?" userId={user.id} /><TradeValidator userId={user.id} displayName={displayName} initialStrategy={strategy} /></main>;
}
