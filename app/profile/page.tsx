import StrategyBuilder from '@/components/StrategyBuilder';
import AuthenticatedAppShell from '@/components/AuthenticatedAppShell';
import { createClient } from '@/lib/supabase/server';
import { getUserDisplayName } from '@/lib/user-display-name';
import { getBillingState } from '@/lib/billing/entitlements';
import { redirect } from 'next/navigation';
import {getRequestLocale} from '@/lib/i18n/server';
import {workspaceText} from '@/lib/i18n/workspace-copy';

export default async function ProfilePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/client/login?next=/profile');
  const [displayName,locale] = await Promise.all([getUserDisplayName(supabase, user),getRequestLocale()]);
  const planCode = (await getBillingState(user.id)).plan;
  return <AuthenticatedAppShell className="builder-container" eyebrow={workspaceText(locale,'TRADE POLICE / TRADING RULES')} displayName={displayName} description={workspaceText(locale,'Define what Trade Police must check before you risk money.')} userId={user.id}><StrategyBuilder userId={user.id} planCode={planCode} /></AuthenticatedAppShell>;
}
