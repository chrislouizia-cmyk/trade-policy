import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getUserDisplayName } from '@/lib/user-display-name';
import AppHeader from '@/components/AppHeader';
import BillingActions from '@/components/BillingActions';
import LanguagePreference from '@/components/i18n/LanguagePreference';
import { getBillingState } from '@/lib/billing/entitlements';
import { billingEnabled } from '@/lib/billing/config';
import { normalizeLocale, type LocalePreference } from '@/lib/i18n/config';
import { getServerTranslator } from '@/lib/i18n/server';

export default async function AccountPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/client/login?next=/account');
  const [{ data: profile }, displayName, state, translator] = await Promise.all([
    supabase.from('profiles').select('preferred_locale').eq('id', user.id).maybeSingle(),
    getUserDisplayName(supabase, user), getBillingState(user.id), getServerTranslator(),
  ]);
  const { locale, t } = translator;
  const preference: LocalePreference = profile?.preferred_locale === 'auto' ? 'auto' : normalizeLocale(profile?.preferred_locale) ?? 'auto';
  const limit = state.entitlements.monthlyAnalysisLimit;
  const date = state.currentPeriodEnd ? new Intl.DateTimeFormat(locale).format(new Date(state.currentPeriodEnd)) : null;
  return <main className="container"><AppHeader eyebrow={t('account.eyebrow')} displayName={displayName} description={t('account.description')} userId={user.id}/><div className="grid grid-2"><section className="card"><p className="eyebrow">{t('nav.account').toUpperCase()}</p><h2>{user.email}</h2><p className="muted">{t('account.authenticated')}</p><Link className="button-link secondary" href="/reset-password">{t('account.changePassword')}</Link></section><section className="card billing-summary"><p className="eyebrow">{t('account.planBilling')}</p><h2>{state.plan}</h2><p>{t('account.status')}: <strong>{state.status.toUpperCase()}</strong></p><p>{t('account.usage')}: <strong>{state.usage}{limit === null ? ` · ${t('account.unlimited')}` : ` / ${limit} ${t('account.analyses')}`}</strong></p>{date && <p>{state.cancelAtPeriodEnd ? t('account.accessEnds') : t('account.renews')}: <strong>{date}</strong></p>}{state.paymentFailed && <p className="error">{t('account.paymentFailed')}</p>}<div className="button-row">{state.stripeCustomerId && billingEnabled() ? <BillingActions mode="portal"/> : state.plan === 'FREE' && billingEnabled() ? <BillingActions mode="checkout"/> : null}<Link className="button-link secondary" href="/pricing">{t('account.comparePlans')}</Link></div><p className="muted">{t('account.billingTrust') || 'Subscription access is synchronized from verified Stripe webhooks.'}</p></section><LanguagePreference userId={user.id} initialPreference={preference}/><section className="card"><p className="eyebrow">{t('nav.tradingAccounts').toUpperCase()}</p><h2>{t('nav.tradingAccounts')}</h2><p className="muted">{locale === 'es' ? 'Agrega, activa y administra tus cuentas de riesgo cuando lo necesites.' : locale === 'fr' ? 'Ajoutez, activez et gérez vos comptes de risque à tout moment.' : 'Add, activate, and manage your risk accounts whenever you need.'}</p><Link className="button-link primary" href="/accounts">{locale === 'es' ? 'Administrar cuentas' : locale === 'fr' ? 'Gérer les comptes' : 'Manage accounts'}</Link></section></div><section className="card risk-callout"><p>{t('account.disclaimer')}</p></section></main>;
}
