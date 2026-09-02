import ActiveTradeMonitor from '@/components/ActiveTradeMonitor';
import AppHeader from '@/components/AppHeader';
import { createClient } from '@/lib/supabase/server';
import { getUserDisplayName } from '@/lib/user-display-name';
import { redirect } from 'next/navigation';
import { getRequestLocale } from '@/lib/i18n/server';
import { getScreenCopy } from '@/lib/i18n/screen-copy';

export default async function ActiveTradePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const [displayName, locale] = await Promise.all([getUserDisplayName(supabase, user), getRequestLocale()]);
  const copy = getScreenCopy(locale).active;
  return <main className="container"><AppHeader eyebrow={copy.eyebrow} displayName={displayName} description={copy.description} userId={user.id} /><ActiveTradeMonitor userId={user.id} /></main>;
}
