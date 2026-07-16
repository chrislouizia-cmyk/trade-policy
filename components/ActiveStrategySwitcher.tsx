'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

type StrategyOption = { id: string; name: string; is_default: boolean; market_types: string[] | null };

export default function ActiveStrategySwitcher() {
  const [strategies, setStrategies] = useState<StrategyOption[]>([]);
  const [activeId, setActiveId] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const refresh=()=>{void load()};
    window.addEventListener('trade-police:strategy-changed',refresh);
    return()=>window.removeEventListener('trade-police:strategy-changed',refresh);
  }, []);

  async function load() {
    const supabase=createClient();
    const [{ data },activeResponse] = await Promise.all([
      supabase.from('strategy_profiles').select('id,name,is_default,market_types').eq('is_archived', false).order('created_at'),
      fetch('/api/strategies/active',{cache:'no-store'}),
    ]);
    const rows = (data ?? []) as StrategyOption[];
    setStrategies(rows);
    const active=activeResponse.ok?await activeResponse.json():null;
    setActiveId(active?.strategy?.id ?? rows.find((row) => row.is_default)?.id ?? rows[0]?.id ?? '');
  }

  async function switchStrategy(id: string) {
    if (!id || id === activeId) return;
    setBusy(true);
    const { error } = await createClient().rpc('set_active_strategy', { target_strategy_id: id });
    if (error) { setBusy(false); window.alert(error.message); return; }
    const response=await fetch('/api/strategies/active',{cache:'no-store'});
    const payload=response.ok?await response.json():null;
    setActiveId(payload?.strategy?.id ?? id);
    setBusy(false);
    router.refresh();
    window.dispatchEvent(new CustomEvent('trade-police:strategy-changed', { detail: { strategyId: payload?.strategy?.id ?? id, strategy:payload?.strategy } }));
  }

  if (!strategies.length) return <a className="button-link" href="/profile">Create strategy</a>;

  return (
    <label className="header-switcher">
      <span>{busy?'Applying strategy…':'Active strategy'}</span>
      <select value={activeId} disabled={busy} onChange={(event) => void switchStrategy(event.target.value)}>
        {strategies.map((strategy) => (
          <option key={strategy.id} value={strategy.id}>{strategy.name}</option>
        ))}
      </select>
    </label>
  );
}
