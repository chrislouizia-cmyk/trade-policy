import TradingAccounts from '@/components/TradingAccounts';
import AppHeader from '@/components/AppHeader';
import { createClient } from '@/lib/supabase/server';
import { getUserDisplayName } from '@/lib/user-display-name';
import { redirect } from 'next/navigation';
import { getServerTranslator } from '@/lib/i18n/server';
import { workspaceText } from '@/lib/i18n/workspace-copy';

export default async function AccountsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const [displayName, { locale }] = await Promise.all([getUserDisplayName(supabase, user), getServerTranslator()]);
  const w = (text: string) => workspaceText(locale, text);
  return <main className="container builder-container"><AppHeader eyebrow={w('TRADE POLICE / TRADING ACCOUNTS')} displayName={displayName} description={w('Add and manage your risk accounts at any time. No broker credentials are required.')} userId={user.id} /><TradingAccounts userId={user.id} /></main>;
}
