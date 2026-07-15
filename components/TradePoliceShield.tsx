'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type ShieldState = {
  hasAccount: boolean;
  hasStrategy: boolean;
  openTrades: number;
};

export default function TradePoliceShield() {
  const [state, setState] = useState<ShieldState>({
    hasAccount: false,
    hasStrategy: false,
    openTrades: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function load() {
      const supabase = createClient();
      const [{ data: account }, { data: strategy }, { count }] = await Promise.all([
        supabase
          .from('trading_accounts')
          .select('id')
          .eq('is_active', true)
          .eq('is_archived', false)
          .maybeSingle(),
        supabase
          .from('strategy_profiles')
          .select('id')
          .eq('is_default', true)
          .eq('is_archived', false)
          .maybeSingle(),
        supabase
          .from('active_trades')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'OPEN'),
      ]);

      if (!active) return;
      setState({
        hasAccount: Boolean(account),
        hasStrategy: Boolean(strategy),
        openTrades: count ?? 0,
      });
      setLoading(false);
    }

    void load();

    const refresh = () => void load();
    window.addEventListener('trade-police:strategy-changed', refresh);
    window.addEventListener('trade-police:account-changed', refresh);

    return () => {
      active = false;
      window.removeEventListener('trade-police:strategy-changed', refresh);
      window.removeEventListener('trade-police:account-changed', refresh);
    };
  }, []);

  const status = useMemo(() => {
    if (loading) {
      return { label: 'CHECKING', tone: 'wait', reason: 'Reviewing trading context…' };
    }
    if (!state.hasAccount || !state.hasStrategy) {
      return {
        label: 'SETUP REQUIRED',
        tone: 'locked',
        reason: !state.hasAccount
          ? 'Create or activate a trading account.'
          : 'Create or activate a strategy.',
      };
    }
    if (state.openTrades > 0) {
      return {
        label: 'MONITORING',
        tone: 'monitoring',
        reason: `${state.openTrades} open trade${state.openTrades === 1 ? '' : 's'} under supervision.`,
      };
    }
    return {
      label: 'READY',
      tone: 'ready',
      reason: 'Account and strategy are ready for validation.',
    };
  }, [loading, state]);

  return (
    <div className={`shield-status ${status.tone}`} title={status.reason}>
      <span className="shield-dot" />
      <span>
        <strong>{status.label}</strong>
        <small>{status.reason}</small>
      </span>
    </div>
  );
}
