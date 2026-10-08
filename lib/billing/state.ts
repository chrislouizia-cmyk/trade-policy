import { planFor, type PlanCode } from './plans.ts';

export type BillingState = {
  plan: PlanCode;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  paymentFailed: boolean;
  stripeCustomerId: string | null;
  usage: number;
  usagePeriodStart: string;
  usagePeriodEnd: string;
  entitlements: ReturnType<typeof planFor>;
};

type BillingSubscriptionRow = {
  stripe_customer_id?: string | null;
  plan?: string | null;
  status?: string | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean | null;
  payment_failed?: boolean | null;
};

const paid = new Set(['active', 'trialing']);

export function buildBillingState(
  subscriptionResult: {
    data: BillingSubscriptionRow | null;
    error: Error | null;
  },
  usageCount: number | null | undefined,
  usagePeriod: { startKey: string; endKey: string },
): BillingState {
  const sub = subscriptionResult.data;
  const rawPlan = String(sub?.plan ?? 'FREE').toUpperCase();
  const status = String(sub?.status ?? 'inactive');
  let plan: PlanCode = 'FREE';

  if (rawPlan === 'PRIVATE_BETA') {
    plan = 'PRIVATE_BETA';
  } else if (paid.has(status)) {
    switch (rawPlan) {
      case 'PRO':
      case 'ELITE':
      case 'TEAM':
      case 'FOUNDER':
        plan = rawPlan;
        break;
    }
  }

  return {
    plan,
    status,
    currentPeriodEnd: sub?.current_period_end ?? null,
    cancelAtPeriodEnd: Boolean(sub?.cancel_at_period_end),
    paymentFailed: Boolean(sub?.payment_failed),
    stripeCustomerId: sub?.stripe_customer_id ?? null,
    usage: usageCount ?? 0,
    usagePeriodStart: usagePeriod.startKey,
    usagePeriodEnd: usagePeriod.endKey,
    entitlements: planFor(plan),
  };
}
