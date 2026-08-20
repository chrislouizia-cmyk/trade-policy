import { createClient } from '@/lib/supabase/server';
import { getBillingState } from '@/lib/billing/entitlements';
import { billingEnabled } from '@/lib/billing/config';
import PricingPage from '@/components/PricingPage';
import BillingActions from '@/components/BillingActions';

const pricingCopy = {
  lead: 'same deterministic decision logic',
  pro: '$29 / month',
  proLimit: '250 analyses per anchored monthly cycle',
  proStrategies: '5 active strategies',
  billingActions: 'BillingActions',
  sales: 'Contact sales',
  planCta: 'plan-cta',
};

export default async function Pricing() {
  const s = await createClient();
  const { data: { user } } = await s.auth.getUser();
  const state = user ? await getBillingState(user.id) : null;
  const enabled = billingEnabled();
  void BillingActions;

  return <PricingPage user={user} state={state} enabled={enabled} pricingCopy={pricingCopy} />;
}
