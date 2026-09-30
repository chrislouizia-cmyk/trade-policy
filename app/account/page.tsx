import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getUserDisplayName } from '@/lib/user-display-name';
import AuthenticatedAppShell from '@/components/AuthenticatedAppShell';
import BillingActions from '@/components/BillingActions';
import LanguagePreference from '@/components/i18n/LanguagePreference';
import TraderIdentitySettings from '@/components/TraderIdentitySettings';
import TraderProfileOverview from '@/components/TraderProfileOverview';
import { getBillingState } from '@/lib/billing/entitlements';
import { billingEnabled } from '@/lib/billing/config';
import { normalizeLocale, type LocalePreference } from '@/lib/i18n/config';
import { getServerTranslator } from '@/lib/i18n/server';
import { buildObservedTraderProfile } from '@/lib/trader-profile-metrics';
import { isTradeLifecycleSimulationRecord } from '@/lib/server/trade-lifecycle-v2';

export default async function AccountPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/client/login?next=/account');
  const [profileResult, closedTradeResult, activeStrategyResult, displayName, state, translator] = await Promise.all([
    supabase.from('profiles').select('preferred_locale,experience_level,trader_type').eq('id', user.id).maybeSingle(),
    supabase.from('active_trades').select('id,trade_record_id,status,outcome,risk_percent,taken_against_verdict,opened_at,closed_at,strategy_snapshot').eq('user_id',user.id).eq('status','CLOSED').order('closed_at',{ascending:false}).limit(100),
    supabase.from('strategy_profiles').select('maximum_risk_percent').eq('user_id',user.id).eq('is_default',true).eq('is_archived',false).maybeSingle(),
    getUserDisplayName(supabase, user), getBillingState(user.id), getServerTranslator(),
  ]);
  const profile=profileResult.data;
  const activeStrategy=activeStrategyResult.data;
  const liveTrades=(closedTradeResult.data??[]).filter(trade=>!isTradeLifecycleSimulationRecord(trade as {strategy_snapshot?:Record<string,unknown>|null}));
  const tradeRecordIds=liveTrades.flatMap(trade=>trade.trade_record_id?[trade.trade_record_id]:[]);
  const postTradeResult=tradeRecordIds.length
    ?await supabase.from('trade_records').select('id,post_analysis').eq('user_id',user.id).in('id',tradeRecordIds)
    :{data:[],error:null};
  const postAnalysisById=new Map((postTradeResult.data??[]).map(row=>[row.id,row.post_analysis]));
  if(closedTradeResult.error||postTradeResult.error){
    console.error('[ACCOUNT_TRADER_PROFILE_LOAD_FAILED]',{closedTrades:closedTradeResult.error?.message??null,postTradeReviews:postTradeResult.error?.message??null,userId:user.id});
  }
  const { locale, t } = translator;
  const preference: LocalePreference = profile?.preferred_locale === 'auto' ? 'auto' : normalizeLocale(profile?.preferred_locale) ?? 'auto';
  const limit = state.entitlements.monthlyAnalysisLimit;
  const date = state.currentPeriodEnd ? new Intl.DateTimeFormat(locale).format(new Date(state.currentPeriodEnd)) : null;
  const observed=buildObservedTraderProfile(liveTrades.map(trade=>({...trade,post_analysis:trade.trade_record_id?postAnalysisById.get(trade.trade_record_id)??null:null})),activeStrategy?.maximum_risk_percent==null?null:Number(activeStrategy.maximum_risk_percent));
  const discordInviteUrl=process.env.NEXT_PUBLIC_DISCORD_INVITE_URL?.trim()||null;
  return <AuthenticatedAppShell eyebrow={t('account.eyebrow')} displayName={displayName} description={t('account.description')} userId={user.id}>
    <div className="account-settings-flow">
      <TraderProfileOverview declaredType={profile?.trader_type??null} experienceLevel={profile?.experience_level??null} observed={observed} historyAvailable={!closedTradeResult.error}/>
      <div className="account-premium-layout">
        <section className="card account-preferences-panel">
          <header className="account-panel-heading"><div><p className="eyebrow">PERSONAL SETTINGS</p><h2>Your trading identity</h2></div><span>Private to your account</span></header>
          <div className="account-email-row"><div><span>Signed-in email</span><strong>{user.email}</strong></div><small>{t('account.authenticated')}</small></div>
          <TraderIdentitySettings userId={user.id} experienceLevel={profile?.experience_level??null} traderType={profile?.trader_type??null}/>
          <div className="account-security-row"><div><span>Security</span><small>Update the password used to protect this account.</small></div><Link className="button-link secondary" href="/reset-password">{t('account.changePassword')}</Link></div>
          <div className="account-language-embedded"><LanguagePreference userId={user.id} initialPreference={preference}/></div>
        </section>
        <aside className="card billing-summary account-plan-panel">
          <div><p className="eyebrow">{t('account.planBilling')}</p><h2>{state.plan}</h2><span className="status-pill positive">{state.status.toUpperCase()}</span></div>
          <dl><div><dt>{t('account.usage')}</dt><dd>{state.usage}{limit === null ? ` · ${t('account.unlimited')}` : ` / ${limit}`}</dd></div>{date?<div><dt>{state.cancelAtPeriodEnd ? t('account.accessEnds') : t('account.renews')}</dt><dd>{date}</dd></div>:null}</dl>
          {state.paymentFailed && <p className="error">{t('account.paymentFailed')}</p>}
          <div className="account-plan-actions">{state.stripeCustomerId && billingEnabled() ? <BillingActions mode="portal"/> : state.plan === 'FREE' && billingEnabled() ? <BillingActions mode="checkout"/> : null}<Link className="button-link secondary" href="/pricing">{t('account.comparePlans')}</Link></div>
        </aside>
      </div>
      <section className="account-action-grid" aria-label="Account tools">
        <article className="card account-action-card"><span className="account-action-icon" aria-hidden="true">↗</span><div><p className="eyebrow">AFFILIATE</p><h2>Affiliate Program</h2><p>Invite traders and track eligible referral rewards.</p></div><Link className="button-link primary account-action-button" href="/account/affiliate">Open Affiliate Program</Link></article>
        <article className="card account-action-card"><span className="account-action-icon" aria-hidden="true">◎</span><div><p className="eyebrow">TRADING</p><h2>{t('nav.tradingAccounts')}</h2><p>{locale === 'es' ? 'Administra tus cuentas y sus límites de riesgo.' : locale === 'fr' ? 'Gérez vos comptes et leurs limites de risque.' : 'Manage your accounts and their risk limits.'}</p></div><Link className="button-link primary account-action-button" href="/accounts">{locale === 'es' ? 'Administrar cuentas' : locale === 'fr' ? 'Gérer les comptes' : 'Manage accounts'}</Link></article>
        <article className="card account-action-card account-community-card"><span className="account-action-icon" aria-hidden="true">#</span><div><p className="eyebrow">COMMUNITY</p><h2>Trade Police Discord</h2><p>Questions, product updates and direct feedback with the community.</p></div>{discordInviteUrl?<a className="button-link primary account-action-button" href={discordInviteUrl} target="_blank" rel="noreferrer">Join Discord</a>:<span className="button-link secondary account-action-button is-disabled" aria-disabled="true">Invite being configured</span>}</article>
      </section>
      <section className="card risk-callout"><p>{t('account.disclaimer')}</p></section>
    </div>
  </AuthenticatedAppShell>;
}
