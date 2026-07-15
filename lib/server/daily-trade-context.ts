import 'server-only';

import type { StrategyProfile } from '@/types/trade';

type SupabaseServerClient = any;

export type DailyTradeContext = {
  strategyTradesToday: number;
  instrumentTradesToday: number;
  extraTradesUsed: number;
  realizedDailyPnl: number;
  openRisk: number;
};

function localDayKey(value: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

export async function loadDailyTradeContext({
  supabase,
  userId,
  strategy,
  instrument,
  accountId,
  timezone,
}: {
  supabase: SupabaseServerClient;
  userId: string;
  strategy: StrategyProfile;
  instrument: string;
  accountId?: string | null;
  timezone: string;
}): Promise<DailyTradeContext> {
  const since = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
  const dayKey = localDayKey(new Date(), timezone);

  let recordsQuery = supabase
    .from('trade_records')
    .select('id,instrument,created_at,realized_pnl,status')
    .eq('user_id', userId)
    .eq('source', 'EXECUTED')
    .gte('created_at', since);

  if (strategy.id) recordsQuery = recordsQuery.eq('strategy_profile_id', strategy.id);
  if (accountId) recordsQuery = recordsQuery.eq('account_id', accountId);

  let openQuery = supabase
    .from('active_trades')
    .select('id,risk_amount,opened_at')
    .eq('user_id', userId)
    .eq('status', 'OPEN');

  if (accountId) openQuery = openQuery.eq('account_id', accountId);

  const [recordsResult, openResult] = await Promise.all([recordsQuery, openQuery]);
  if (recordsResult.error) throw recordsResult.error;
  if (openResult.error) throw openResult.error;

  const todayRecords = (recordsResult.data ?? []).filter(
    (row: any) => localDayKey(new Date(row.created_at), timezone) === dayKey,
  );

  const strategyTradesToday = todayRecords.length;
  const instrumentTradesToday = todayRecords.filter(
    (row: any) => row.instrument === instrument,
  ).length;
  const realizedDailyPnl = todayRecords.reduce(
    (sum: number, row: any) => sum + Number(row.realized_pnl ?? 0),
    0,
  );
  const openRisk = (openResult.data ?? []).reduce(
    (sum: number, row: any) => sum + Math.max(0, Number(row.risk_amount ?? 0)),
    0,
  );

  return {
    strategyTradesToday,
    instrumentTradesToday,
    extraTradesUsed: Math.max(0, strategyTradesToday - strategy.maximumTradesPerDay),
    realizedDailyPnl,
    openRisk,
  };
}
