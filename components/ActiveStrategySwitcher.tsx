'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { clearUserScopedSessionState, getUserScopedStorageKey, readUserScopedSelection, writeUserScopedSelection } from '@/lib/user-session-state';
import { useLocale } from '@/components/i18n/LocaleProvider';
import { workspaceText } from '@/lib/i18n/workspace-copy';

type StrategyOption = { id: string; name: string; is_default: boolean; market_types: string[] | null; user_id?: string };

export default function ActiveStrategySwitcher() {
  const { locale } = useLocale();
  const w = (text: string) => workspaceText(locale, text);
  const [strategies, setStrategies] = useState<StrategyOption[]>([]);
  const [activeId, setActiveId] = useState('');
  const [busy, setBusy] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [stateMessage, setStateMessage] = useState('');
  const previousUserRef = useRef<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      const nextUserId = session?.user?.id ?? null;
      if (previousUserRef.current && previousUserRef.current !== nextUserId) {
        clearUserScopedSessionState(previousUserRef.current);
      }
      previousUserRef.current = nextUserId;
      setUserId(nextUserId);
      if (event === 'SIGNED_OUT') {
        setStrategies([]);
        setActiveId('');
        setStateMessage('No active user session. Log in to continue.');
        return;
      }
      if (nextUserId) {
        await load(nextUserId);
      }
    });

    void supabase.auth.getUser().then(({ data: { user } }) => {
      const nextUserId = user?.id ?? null;
      if (previousUserRef.current && previousUserRef.current !== nextUserId) {
        clearUserScopedSessionState(previousUserRef.current);
      }
      previousUserRef.current = nextUserId;
      setUserId(nextUserId);
      if (nextUserId) {
        void load(nextUserId);
      }
    });

    const handleStorage = (event: StorageEvent) => {
      if (!event.key || !event.key.startsWith('trade-police:active-strategy')) return;
      if (userId) {
        const scopedKey = getUserScopedStorageKey('trade-police:active-strategy', userId);
        if (event.key !== scopedKey) return;
      }
      void load(userId ?? undefined);
    };

    window.addEventListener('storage', handleStorage);
    const refresh = () => void load(userId ?? undefined);
    window.addEventListener('trade-police:strategy-changed', refresh);

    return () => {
      authListener?.subscription.unsubscribe();
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('trade-police:strategy-changed', refresh);
    };
  }, [userId]);

  async function load(nextUserId?: string | null) {
    const supabase = createClient();
    const resolvedUserId = nextUserId ?? userId;
    if (!resolvedUserId) {
      setStrategies([]);
      setActiveId('');
      return;
    }

    const [{ data }, activeResponse] = await Promise.all([
      supabase.from('strategy_profiles').select('id,name,is_default,market_types,user_id').eq('user_id', resolvedUserId).eq('is_archived', false).order('created_at'),
      fetch('/api/strategies/active', { cache: 'no-store' }),
    ]);

    const rows = ((data ?? []) as StrategyOption[]).filter((row) => row.user_id === resolvedUserId || row.user_id === undefined);
    setStrategies(rows);

    const activeStrategyId = readUserScopedSelection('trade-police:active-strategy', resolvedUserId);
    const active = activeResponse.ok ? await activeResponse.json() : null;
    const current = active?.strategy?.id ?? activeStrategyId ?? rows.find((row) => row.is_default)?.id ?? rows[0]?.id ?? '';

    const ownedCurrent = rows.some((row) => row.id === current);
    const nextId = ownedCurrent ? current : rows[0]?.id ?? '';
    setActiveId(nextId);
    writeUserScopedSelection('trade-police:active-strategy', resolvedUserId, nextId || null);
    setStateMessage(rows.length ? '' : 'No strategy is available for this user yet.');
  }

  async function switchStrategy(id: string) {
    if (!id || id === activeId) return;
    setBusy(true);
    const { error } = await createClient().rpc('set_active_strategy', { target_strategy_id: id });
    if (error) {
      setBusy(false);
      setStateMessage(error.message);
      return;
    }
    const response = await fetch('/api/strategies/active', { cache: 'no-store' });
    const payload = response.ok ? await response.json() : null;
    const nextId = payload?.strategy?.id ?? id;
    setActiveId(nextId);
    if (userId) writeUserScopedSelection('trade-police:active-strategy', userId, nextId);
    setStateMessage('');
    setBusy(false);
    router.refresh();
    window.dispatchEvent(new CustomEvent('trade-police:strategy-changed', { detail: { strategyId: nextId, strategy: payload?.strategy } }));
  }

  if (!strategies.length) return <div className="header-switcher message-inline"><span>{w('Active strategy')}</span><small className="inline-state">{stateMessage ? w(stateMessage) : w('No strategy available for this user.')}</small></div>;

  return (
    <label className="header-switcher">
      <span>{busy ? w('Applying strategy…') : w('Active strategy')}</span>
      <select value={activeId} disabled={busy} onChange={(event) => void switchStrategy(event.target.value)}>
        {strategies.map((strategy) => (
          <option key={strategy.id} value={strategy.id}>{strategy.name}</option>
        ))}
      </select>
      {stateMessage ? <small className="inline-state">{w(stateMessage)}</small> : null}
    </label>
  );
}
