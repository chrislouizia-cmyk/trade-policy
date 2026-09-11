import { redirect } from 'next/navigation';
import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import AppHeader from '@/components/AppHeader';
import AffiliateShareLink from '@/components/AffiliateShareLink';
import { getUserDisplayName } from '@/lib/user-display-name';

function money(minor: number | null | undefined, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format((minor ?? 0) / 100);
}

async function applyForAffiliate() {
  'use server';

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/client/login?next=/account/affiliate');

  const { error } = await supabase.rpc('apply_for_affiliate');

  if (error) throw new Error('Unable to create affiliate application.');

  revalidatePath('/account');
  revalidatePath('/account/affiliate');
}

export default async function AffiliateAccountPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/client/login?next=/account/affiliate');

  const displayName = await getUserDisplayName(supabase, user);

  const { data: affiliate, error: affiliateError } = await supabase
    .from('affiliate_profiles')
    .select(
      'id,status,referral_code,payout_currency,payout_method,payout_threshold_minor,created_at'
    )
    .eq('user_id', user.id)
    .maybeSingle();

  if (affiliateError) {
    throw new Error('Unable to load affiliate profile.');
  }

  if (!affiliate) {
    return (
      <main className="container">
        <AppHeader
          eyebrow="ACCOUNT"
          displayName={displayName}
          description="Affiliate Program"
          userId={user.id}
        />

        <section className="card">
          <p className="eyebrow">AFFILIATE PROGRAM</p>
          <h2>Earn by introducing traders to Trade Police.</h2>
          <p className="muted">
            Earn 10% of each eligible payment during the first 12 months
            of every customer you refer.
          </p>

          <form action={applyForAffiliate}>
            <button className="button-link primary" type="submit">
              Apply to become an affiliate
            </button>
          </form>

          <p className="muted">
            Applications require approval before referrals can begin earning.
          </p>
        </section>

        <p>
          <Link className="button-link secondary" href="/account">
            Back to Account
          </Link>
        </p>
      </main>
    );
  }

  const [
    { data: referrals },
    { data: balances },
    { data: payouts },
    { data: clicks },
  ] = await Promise.all([
      supabase
        .from('affiliate_referrals')
        .select('id,status,first_successful_payment_at,attributed_at')
        .eq('affiliate_id', affiliate.id),
      supabase.rpc('affiliate_balances', {
        p_affiliate_id: affiliate.id,
      }),
      supabase
        .from('affiliate_payouts')
        .select('id,status,total_minor,paid_at,created_at')
        .eq('affiliate_id', affiliate.id)
        .order('created_at', { ascending: false })
        .limit(5),
      supabase.rpc('affiliate_click_count', {
        p_affiliate_id: affiliate.id,
      }),
    ]);

  const referralRows = referrals ?? [];
  const payingCustomers = referralRows.filter(
    (row) => row.first_successful_payment_at
  ).length;

  const balance = Array.isArray(balances) ? balances[0] : balances;

  return (
    <main className="container">
      <AppHeader
        eyebrow="ACCOUNT"
        displayName={displayName}
        description="Affiliate Program"
        userId={user.id}
      />

      <section className="card">
        <p className="eyebrow">AFFILIATE PROGRAM</p>
        <h2>{affiliate.status === 'APPROVED' ? 'Affiliate Dashboard' : 'Application status'}</h2>
        <p>
          Status: <strong>{affiliate.status}</strong>
        </p>

        {affiliate.status === 'APPROVED' ? (
          <>
            <AffiliateShareLink referralCode={affiliate.referral_code} />

            <div className="grid grid-2">
              <section className="card">
                <p className="eyebrow">CLICKS</p>
                <h2>{clicks ?? 0}</h2>
                <p className="muted">Unique first-touch visits</p>
              </section>
              <section className="card">
                <p className="eyebrow">SIGNUPS</p>
                <h2>{referralRows.length}</h2>
              </section>

              <section className="card">
                <p className="eyebrow">PAYING CUSTOMERS</p>
                <h2>{payingCustomers}</h2>
              </section>

              <section className="card">
                <p className="eyebrow">PENDING</p>
                <h2>{money(balance?.pending_minor, affiliate.payout_currency)}</h2>
              </section>

              <section className="card">
                <p className="eyebrow">AVAILABLE</p>
                <h2>{money(balance?.available_minor, affiliate.payout_currency)}</h2>
              </section>

              <section className="card">
                <p className="eyebrow">PAID</p>
                <h2>{money(balance?.paid_minor, affiliate.payout_currency)}</h2>
              </section>

              <section className="card">
                <p className="eyebrow">PAYOUT METHOD</p>
                <h2>{affiliate.payout_method.replaceAll('_', ' ')}</h2>
                <p className="muted">
                  Threshold: {money(
                    affiliate.payout_threshold_minor,
                    affiliate.payout_currency
                  )}
                </p>
              </section>
            </div>

            <section className="card">
              <p className="eyebrow">RECENT PAYOUTS</p>
              {payouts && payouts.length > 0 ? (
                payouts.map((payout) => (
                  <p key={payout.id}>
                    <strong>
                      {money(payout.total_minor, affiliate.payout_currency)}
                    </strong>{' '}
                    · {payout.status}
                  </p>
                ))
              ) : (
                <p className="muted">No payouts yet.</p>
              )}
            </section>
          </>
        ) : (
          <p className="muted">
            Your application has been received. Referral earnings remain
            disabled until Trade Police approves the affiliate account.
          </p>
        )}
      </section>

      <p>
        <Link className="button-link secondary" href="/account">
          Back to Account
        </Link>
      </p>
    </main>
  );
}
