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

  async function load() {
    const { data } = await createClient()
      .from('strategy_profiles')
      .select('id,name,is_default,market_types')
      .eq('is_archived', false)
      .order('created_at');
    const rows = (data ?? []) as StrategyOption[];
    setStrategies(rows);
    setActiveId(rows.find((row) => row.is_default)?.id ?? rows[0]?.id ?? '');
  }

  async function switchStrategy(id: string) {
    if (!id || id === activeId) return;
    setBusy(true);
    const { error } = await createClient().rpc('set_active_strategy', { target_strategy_id: id });
    setBusy(false);
    if (error) { window.alert(error.message); return; }
    setActiveId(id);
    router.refresh();
    window.dispatchEvent(new CustomEvent('trade-police:strategy-changed', { detail: { strategyId: id } }));
  }

  if (!strategies.length) return <a className="button-link" href="/profile">Create strategy</a>;

  return (
    <label className="header-switcher">
      <span>Active strategy</span>
      <select value={activeId} disabled={busy} onChange={(event) => void switchStrategy(event.target.value)}>
        {strategies.map((strategy) => (
          <option key={strategy.id} value={strategy.id}>{strategy.name}</option>
        ))}
      </select>
    </label>
  );
}
