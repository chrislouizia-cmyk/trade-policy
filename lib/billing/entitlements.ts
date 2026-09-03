import 'server-only';

import { createAdminClient } from '../supabase/admin.ts';
import { getAnchoredMonthlyPeriod } from './period.ts';
import { planFor, type PlanCode } from './plans.ts';
import { buildBillingState, type BillingState } from './state.ts';

export { buildBillingState, type BillingState } from './state.ts';

async function getCanonicalEffectivePlanCode(userId: string): Promise<PlanCode> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('get_effective_plan_code_for_user', {
    p_user_id: userId,
  });

  if (error || data === null || data === undefined) {
    throw new Error(`Effective plan could not be resolved. ${error?.message ?? ''}`.trim());
  }

  const plan = String(data).trim().toUpperCase() as PlanCode;
  return planFor(plan).code;
}

type UsageAnchorRow = {
  created_at: string;
};

async function getUsagePeriod(userId: string, now: Date = new Date()) {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from('analysis_usage')
    .select('created_at')
    .eq('user_id', userId)
    .in('status', ['RESERVED', 'COMPLETED'])
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Billing usage anchor lookup failed', {
      userId,
      error,
    });
    throw new Error('Analysis usage is temporarily unavailable.');
  }

  const anchor = data
    ? new Date((data as UsageAnchorRow).created_at)
    : now;

  return getAnchoredMonthlyPeriod(anchor, now);
}

export async function getBillingState(userId: string): Promise<BillingState> {
  const admin = createAdminClient();
  const usagePeriod = await getUsagePeriod(userId);

  const [subscriptionResult, usageResult] = await Promise.all([
    admin
      .from('billing_subscriptions')
      .select(
        'stripe_customer_id,plan,status,current_period_end,cancel_at_period_end,payment_failed',
      )
      .eq('user_id', userId)
      .maybeSingle(),

    admin
      .from('analysis_usage')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'COMPLETED')
      .eq('period_start', usagePeriod.startKey),
  ]);

  if (subscriptionResult.error) {
    console.error('Billing subscription lookup failed', {
      userId,
      error: subscriptionResult.error,
    });
    throw new Error('Billing status is temporarily unavailable.');
  }

  if (usageResult.error) {
    console.error('Billing usage lookup failed', {
      userId,
      error: usageResult.error,
    });
    throw new Error('Analysis usage is temporarily unavailable.');
  }

  const state = buildBillingState(
    subscriptionResult,
    usageResult.count,
    usagePeriod,
  );

  const effectivePlan = await getCanonicalEffectivePlanCode(userId);
  return {
    ...state,
    plan: effectivePlan,
    entitlements: planFor(effectivePlan),
  };
}

export async function reserveAnalysis(
  userId: string,
  requestKey: string,
) {
  const state = await getBillingState(userId);
  const admin = createAdminClient();
  const periodKey = state.usagePeriodStart;

  const { data: existing, error: existingError } = await admin
    .from('analysis_usage')
    .select('id,status')
    .eq('user_id', userId)
    .eq('request_key', requestKey)
    .maybeSingle();

  if (existingError) {
    console.error('Billing usage lookup failed during reservation', {
      userId,
      requestKey,
      error: existingError,
    });
    throw new Error('Analysis usage is temporarily unavailable.');
  }

  if (existing) {
    return {
      allowed: existing.status !== 'FAILED',
      state,
      reservation: existing,
      duplicate: true,
    };
  }

  const { data, error } = await admin
    .from('analysis_usage')
    .insert({
      user_id: userId,
      request_key: requestKey,
      period_start: periodKey,
      status: 'RESERVED',
    })
    .select('id,status')
    .single();

  if (error) {
    console.error('Billing usage reservation failed', {
      userId,
      requestKey,
      error,
    });
    throw new Error('Analysis usage is temporarily unavailable.');
  }

  if (state.entitlements.monthlyAnalysisLimit !== null) {
    const { count, error: countError } = await admin
      .from('analysis_usage')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('period_start', periodKey)
      .in('status', ['RESERVED', 'COMPLETED']);

    if (countError) {
      console.error('Billing usage count failed during reservation', {
        userId,
        requestKey,
        periodKey,
        error: countError,
      });
      throw new Error('Analysis usage is temporarily unavailable.');
    }

    if ((count ?? 0) > state.entitlements.monthlyAnalysisLimit) {
      await admin
        .from('analysis_usage')
        .update({
          status: 'FAILED',
          completed_at: new Date().toISOString(),
        })
        .eq('id', data.id);

      return {
        allowed: false,
        state,
        reservation: data,
      };
    }
  }

  return {
    allowed: true,
    state,
    reservation: data,
  };
}

export async function finalizeAnalysis(
  userId: string,
  requestKey: string,
  success: boolean,
) {
  const admin = createAdminClient();

  const { error } = await admin
    .from('analysis_usage')
    .update({
      status: success ? 'COMPLETED' : 'FAILED',
      completed_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('request_key', requestKey)
    .eq('status', 'RESERVED');

  if (error) {
    console.error('Billing usage finalization failed', {
      userId,
      requestKey,
      success,
      error,
    });
    throw new Error('Analysis usage could not be finalized.');
  }
}
