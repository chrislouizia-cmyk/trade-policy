import 'server-only';

export type PublicPlan = 'PRO' | 'ELITE' | 'TEAM';
export type BillingInterval = 'monthly' | 'annual';

export function billingEnabled(){return process.env.BILLING_ENABLED==='true'}

export function normalizePublicPlan(value: unknown): PublicPlan | null {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (normalized === 'PRO' || normalized === 'ELITE' || normalized === 'TEAM') return normalized;
  return null;
}

export function normalizeBillingInterval(value: unknown): BillingInterval | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'monthly' || normalized === 'month') return 'monthly';
  if (normalized === 'annual' || normalized === 'year' || normalized === 'yearly') return 'annual';
  return null;
}

export function billingConfig(){
  if(!billingEnabled())return null;
  const values={
    secretKey:process.env.STRIPE_SECRET_KEY,
    webhookSecret:process.env.STRIPE_WEBHOOK_SECRET,
    proMonthlyPriceId:process.env.STRIPE_PRO_MONTHLY_PRICE_ID,
    proAnnualPriceId:process.env.STRIPE_PRO_ANNUAL_PRICE_ID,
    eliteMonthlyPriceId:process.env.STRIPE_ELITE_MONTHLY_PRICE_ID,
    eliteAnnualPriceId:process.env.STRIPE_ELITE_ANNUAL_PRICE_ID,
    teamMonthlyPriceId:process.env.STRIPE_TEAM_MONTHLY_PRICE_ID,
    teamAnnualPriceId:process.env.STRIPE_TEAM_ANNUAL_PRICE_ID,
    appUrl:process.env.NEXT_PUBLIC_APP_URL,
  };
  const required=['secretKey','webhookSecret','proMonthlyPriceId','proAnnualPriceId','eliteMonthlyPriceId','eliteAnnualPriceId','teamMonthlyPriceId','teamAnnualPriceId','appUrl'];
  const missingRequired=required.filter((key)=>!values[key as keyof typeof values]);
  if(missingRequired.length)throw new Error(`Billing is enabled but configuration is missing: ${missingRequired.join(', ')}`);
  return values as Record<keyof typeof values,string>;
}

export function getStripeCheckoutPriceId(plan: PublicPlan, interval: BillingInterval): string | null {
  const config=billingConfig();
  if(!config) return null;
  const map={
    PRO:{ monthly: config.proMonthlyPriceId, annual: config.proAnnualPriceId },
    ELITE:{ monthly: config.eliteMonthlyPriceId, annual: config.eliteAnnualPriceId },
    TEAM:{ monthly: config.teamMonthlyPriceId, annual: config.teamAnnualPriceId },
  } satisfies Record<PublicPlan, Record<BillingInterval, string | undefined>>;
  return map[plan][interval] ?? null;
}

export function stripeCheckoutSupported(plan: PublicPlan, interval: BillingInterval){
  return getStripeCheckoutPriceId(plan, interval) !== null;
}
