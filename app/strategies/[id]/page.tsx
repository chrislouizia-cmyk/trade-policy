import Link from 'next/link';
import { notFound } from 'next/navigation';
import StrategyDetailPage from '@/components/StrategyDetailPage';
import AppHeader from '@/components/AppHeader';
import { createClient } from '@/lib/supabase/server';
import { getUserDisplayName } from '@/lib/user-display-name';

export default async function StrategyDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return notFound();
  }

  const [strategyResult, rulesResult, sessionsResult, backtestsResult] = await Promise.all([
    supabase.from('strategy_profiles').select('*').eq('id', id).eq('user_id', user.id).maybeSingle(),
    supabase.from('strategy_rules').select('*').eq('strategy_id', id).order('sort_order', { ascending: true }),
    supabase.from('strategy_sessions').select('*').eq('strategy_id', id).order('created_at', { ascending: true }),
    supabase.from('backtest_runs').select('*').eq('user_id', user.id).eq('strategy_profile_id', id).order('created_at', { ascending: false }),
  ]);

  if (strategyResult.error || !strategyResult.data) {
    return notFound();
  }

  const strategy = strategyResult.data;
  const displayName = await getUserDisplayName(supabase, user);

  const planCode = await (async () => {
    const { data: subscription } = await supabase
      .from('billing_subscriptions')
      .select('plan,status')
      .eq('user_id', user.id)
      .maybeSingle();

    const status = String(subscription?.status ?? 'inactive').toLowerCase();
    const plan = String(subscription?.plan ?? 'FREE').toUpperCase();
    if (status !== 'active' && status !== 'trialing') return 'FREE';
    return ['PRO', 'ELITE', 'TEAM'].includes(plan) ? plan : 'FREE';
  })();

  return (
    <main className="container builder-container">
      <AppHeader eyebrow="TRADE POLICE / STRATEGY DETAIL" displayName={displayName} description="Review rules, execute backtests, and keep the strategy context in one place." userId={user.id} />
      <StrategyDetailPage
        strategy={{
          id: strategy.id,
          name: strategy.name,
          description: strategy.description,
          market_types: strategy.market_types,
          instruments: strategy.instruments,
          macro_timeframe: strategy.macro_timeframe,
          trend_timeframe: strategy.trend_timeframe,
          confirmation_timeframe: strategy.confirmation_timeframe,
          entry_timeframe: strategy.entry_timeframe,
          trigger_timeframe: strategy.trigger_timeframe,
          maximum_risk_percent: strategy.maximum_risk_percent,
          minimum_rr: strategy.minimum_rr,
          authorization_score: strategy.authorization_score,
          wait_score: strategy.wait_score,
          created_at: strategy.created_at,
          updated_at: strategy.updated_at,
          is_default: strategy.is_default,
          allowed_sessions: strategy.allowed_sessions,
          required_evidence: strategy.required_evidence,
          stop_limits: strategy.stop_limits,
        }}
        rules={rulesResult.data ?? []}
        sessions={sessionsResult.data ?? []}
        initialRuns={backtestsResult.data ?? []}
        planCode={planCode}
      />
    </main>
  );
}
