import 'server-only';
import { createAdminClient } from '../supabase/admin.ts';
import { planFor, type PlanCode } from './plans.ts';
import { getMonthlyPeriodStartKey } from './period.ts';

export type BillingState = {
  plan: PlanCode;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  paymentFailed: boolean;
  stripeCustomerId: string | null;
  usage: number;
  entitlements: ReturnType<typeof planFor>;
};

const paid = new Set(['active', 'trialing']);

type BillingSubscriptionRow = {
  stripe_customer_id?: string | null;
  plan?: string | null;
  status?: string | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean | null;
  payment_failed?: boolean | null;
};

export function buildBillingState(subscriptionResult: { data: BillingSubscriptionRow | null; error: Error | null }, usageCount: number | null | undefined): BillingState {
  const sub = subscriptionResult.data;
  const plan: PlanCode = sub && paid.has(String(sub.status)) && sub.plan === 'PRO' ? 'PRO' : 'FREE';
  return {
    plan,
    status: String(sub?.status ?? 'inactive'),
    currentPeriodEnd: sub?.current_period_end ?? null,
    cancelAtPeriodEnd: Boolean(sub?.cancel_at_period_end),
    paymentFailed: Boolean(sub?.payment_failed),
    stripeCustomerId: sub?.stripe_customer_id ?? null,
    usage: usageCount ?? 0,
    entitlements: planFor(plan),
  };
}

export async function getBillingState(userId: string): Promise<BillingState> {
  const admin = createAdminClient();
  const periodKey = getMonthlyPeriodStartKey();
  const [subscriptionResult, usageResult] = await Promise.all([
    admin.from('billing_subscriptions').select('stripe_customer_id,plan,status,current_period_end,cancel_at_period_end,payment_failed').eq('user_id', userId).maybeSingle(),
    admin.from('analysis_usage').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'COMPLETED').gte('period_start', periodKey),
  ]);

  if (subscriptionResult.error) {
    console.error('Billing subscription lookup failed', { userId, error: subscriptionResult.error });
    throw new Error('Billing status is temporarily unavailable.');
  }
  if (usageResult.error) {
    console.error('Billing usage lookup failed', { userId, error: usageResult.error });
    throw new Error('Analysis usage is temporarily unavailable.');
  }

  return buildBillingState(subscriptionResult, usageResult.count);
}

export async function reserveAnalysis(userId: string, requestKey: string) {
  const state = await getBillingState(userId);
  const admin = createAdminClient();
  const periodKey = getMonthlyPeriodStartKey();

  const { data: existing, error: existingError } = await admin.from('analysis_usage').select('id,status').eq('user_id', userId).eq('request_key', requestKey).maybeSingle();
  if (existingError) {
    console.error('Billing usage lookup failed during reservation', { userId, requestKey, error: existingError });
    throw new Error('Analysis usage is temporarily unavailable.');
  }
  if (existing) {
    return { allowed: existing.status !== 'FAILED', state, reservation: existing, duplicate: true };
  }

  const { data, error } = await admin.from('analysis_usage').insert({
    user_id: userId,
    request_key: requestKey,
    period_start: periodKey,
    status: 'RESERVED',
  }).select('id,status').single();

  if (error) {
    console.error('Billing usage reservation failed', { userId, requestKey, error });
    throw new Error('Analysis usage is temporarily unavailable.');
  }

  if (state.entitlements.monthlyAnalysisLimit !== null) {
    const { count, error: countError } = await admin.from('analysis_usage').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('period_start', periodKey).in('status', ['RESERVED', 'COMPLETED']);
    if (countError) {
      console.error('Billing usage count failed during reservation', { userId, requestKey, periodKey, error: countError });
      throw new Error('Analysis usage is temporarily unavailable.');
    }
    if ((count ?? 0) > state.entitlements.monthlyAnalysisLimit) {
      const { error: updateError } = await admin.from('analysis_usage').update({ status: 'FAILED', completed_at: new Date().toISOString() }).eq('id', data.id);
      if (updateError) {
        console.error('Billing usage release failed', { userId, requestKey, id: data.id, error: updateError });
        throw new Error('Analysis usage is temporarily unavailable.');
      }
      return { allowed: false, state, reservation: data };
    }
  }

  return { allowed: true, state, reservation: data };
}

export async function finalizeAnalysis(userId: string, requestKey: string, success: boolean) {
  const admin = createAdminClient();
  const { error } = await admin.from('analysis_usage').update({ status: success ? 'COMPLETED' : 'FAILED', completed_at: new Date().toISOString() }).eq('user_id', userId).eq('request_key', requestKey).eq('status', 'RESERVED');
  if (error) {
    console.error('Billing usage finalization failed', { userId, requestKey, success, error });
    throw new Error('Analysis usage could not be finalized.');
  }
}
