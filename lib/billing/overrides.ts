import { planFor, type PlanCode } from './plans.ts';
import type { BillingState } from './state.ts';

const SERVER_ENTITLEMENT_OVERRIDES: Readonly<Record<string, PlanCode>> = Object.freeze({
  '65a21633-51ea-419b-bd0c-e43f81c63b4e': 'FOUNDER',
  'cee066a8-a590-4c1a-9c56-5e1c3617ca26': 'FOUNDER',
  '935d9d88-893b-4163-b276-50bdb63c55e0': 'FOUNDER',
});

export function serverEntitlementOverride(userId: string): PlanCode | null {
  return SERVER_ENTITLEMENT_OVERRIDES[userId] ?? null;
}

export function applyServerEntitlementOverride(userId: string, state: BillingState): BillingState {
  const plan = serverEntitlementOverride(userId);
  return plan ? {...state, plan, entitlements: planFor(plan)} : state;
}
