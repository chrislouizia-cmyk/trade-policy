import TradeValidator from '@/components/TradeValidator';
import AppHeader from '@/components/AppHeader';
import { createClient } from '@/lib/supabase/server';
import { getUserDisplayName } from '@/lib/user-display-name';
import { redirect } from 'next/navigation';
import { loadActiveStrategy, loadStrategyById, NoActiveStrategyError, StrategyNotFoundError } from '@/lib/server/active-strategy';
import { StrategyConfigurationError } from '@/lib/strategy-policy';
import {getRequestLocale} from '@/lib/i18n/server';
import {getScreenCopy} from '@/lib/i18n/screen-copy';
import {strategyRevisionId} from '@/lib/historical-decisions/strategy-revision';

export default async function ValidatePage({ searchParams }: { searchParams: Promise<{ strategy?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/client/login?next=/validate');
  const [displayName,locale] = await Promise.all([getUserDisplayName(supabase, user),getRequestLocale()]);
  const c=getScreenCopy(locale).decision;
  const strategyId = params.strategy?.trim();
  let strategy;
  try {
    strategy = strategyId ? await loadStrategyById(supabase, user.id, strategyId) : await loadActiveStrategy(supabase, user.id);
  } catch (error) {
    if (!((error instanceof NoActiveStrategyError) || (error instanceof StrategyNotFoundError) || (error instanceof StrategyConfigurationError))) throw error;
    const heading = error instanceof StrategyNotFoundError ? c.notFound : error instanceof NoActiveStrategyError ? c.noActive : c.needsConfiguration;
    return <main className="container"><AppHeader eyebrow={c.eyebrow} displayName={displayName} description={c.description} userId={user.id} decisionFocused showContext /><div className="card empty-state"><h2>{heading}</h2><a className="button-link primary" href="/profile">{c.configure}</a></div></main>;
  }
  return <main className="container"><AppHeader eyebrow={c.eyebrow} displayName={displayName} description={c.description} userId={user.id} decisionFocused showContext /><TradeValidator userId={user.id} displayName={displayName} initialStrategy={strategy} initialStrategyRevisionId={strategyRevisionId(strategy)} initialSelectionMode={strategyId ? 'REQUESTED' : 'ACTIVE'} /></main>;
}
