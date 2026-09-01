import TradeValidator from '@/components/TradeValidator';
import AppHeader from '@/components/AppHeader';
import { createClient } from '@/lib/supabase/server';
import { getUserDisplayName } from '@/lib/user-display-name';
import { redirect } from 'next/navigation';
import { loadActiveStrategy, loadStrategyById, NoActiveStrategyError, StrategyNotFoundError } from '@/lib/server/active-strategy';
import { StrategyConfigurationError } from '@/lib/strategy-policy';

export default async function ValidatePage({ searchParams }: { searchParams: Promise<{ strategy?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const displayName = await getUserDisplayName(supabase, user);
  const strategyId = params.strategy?.trim();
  let strategy;
  try {
    strategy = strategyId ? await loadStrategyById(supabase, user.id, strategyId) : await loadActiveStrategy(supabase, user.id);
  } catch (error) {
    if (!((error instanceof NoActiveStrategyError) || (error instanceof StrategyNotFoundError) || (error instanceof StrategyConfigurationError))) throw error;
    const heading = error instanceof StrategyNotFoundError ? 'Saved strategy not found' : error instanceof NoActiveStrategyError ? 'No active strategy' : 'Active strategy needs configuration';
    return <main className="container"><AppHeader eyebrow="TRADE POLICE / ANALYZE" displayName={displayName} description="Should I take this trade?" userId={user.id} /><div className="card empty-state"><h2>{heading}</h2><p className="muted">{error.message}</p><a className="button-link primary" href="/profile">Build or configure strategy</a></div></main>;
  }
  return <main className="container"><AppHeader eyebrow="TRADE POLICE / ANALYZE" displayName={displayName} description="Should I take this trade?" userId={user.id} /><TradeValidator userId={user.id} displayName={displayName} initialStrategy={strategy} /></main>;
}
