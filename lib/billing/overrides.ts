import 'server-only';

import { createAdminClient } from '../supabase/admin.ts';
import { planFor, type PlanCode } from './plans.ts';
import type { BillingState } from './state.ts';

type EntitlementOverrideRow = { plan_code: string };

function normalizeOverridePlan(value: unknown): PlanCode | null {
  const plan = String(value ?? '').trim().toUpperCase();
  switch (plan) {
    case 'FREE':
    case 'PRIVATE_BETA':
    case 'PRO':
    case 'ELITE':
    case 'TEAM':
    case 'FOUNDER':
      return plan;
    default:
      return null;
  }
}

export async function serverEntitlementOverride(userId: string): Promise<PlanCode | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('internal_entitlement_overrides')
    .select('plan_code')
    .eq('user_id', userId)
    .eq('active', true)
    .maybeSingle();

  if (error) {
    throw new Error(`Server entitlement override could not be resolved. ${error.message}`);
  }

  return normalizeOverridePlan((data as EntitlementOverrideRow | null)?.plan_code);
}

export async function applyServerEntitlementOverride(
  userId: string,
  state: BillingState,
): Promise<BillingState> {
  const plan = await serverEntitlementOverride(userId);
  return plan ? { ...state, plan, entitlements: planFor(plan) } : state;
}
