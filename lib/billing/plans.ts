export type PlanCode =
  | 'FREE'
  | 'PRIVATE_BETA'
  | 'PRO'
  | 'ELITE'
  | 'TEAM'
  | 'FOUNDER';

export type PlanDefinition = {
  code: PlanCode;
  name: string;
  monthlyAnalysisLimit: number | null;
  maximumActiveStrategies: number | null;
  canViewCompleteDecisionReport: boolean;
  canUseExpandedHistory: boolean;
  canUseExpandedAnalytics: boolean;
  checkoutEnabled: boolean;
};

export const PLANS: Record<PlanCode, PlanDefinition> = {

  FREE: {
    code: 'FREE',
    name: 'Free',
    monthlyAnalysisLimit: 15,
    maximumActiveStrategies: 1,
    canViewCompleteDecisionReport: false,
    canUseExpandedHistory: false,
    canUseExpandedAnalytics: false,
    checkoutEnabled: false,
  },

  PRIVATE_BETA: {
    code: 'PRIVATE_BETA',
    name: 'Private Beta',
    monthlyAnalysisLimit: 80,
    maximumActiveStrategies: 5,
    canViewCompleteDecisionReport: true,
    canUseExpandedHistory: true,
    canUseExpandedAnalytics: true,
    checkoutEnabled: false,
  },

  PRO: {
    code: 'PRO',
    name: 'Pro',
    monthlyAnalysisLimit: 250,
    maximumActiveStrategies: 5,
    canViewCompleteDecisionReport: true,
    canUseExpandedHistory: true,
    canUseExpandedAnalytics: true,
    checkoutEnabled: true,
  },

  ELITE: {
    code: 'ELITE',
    name: 'Elite',
    monthlyAnalysisLimit: 1000,
    maximumActiveStrategies: 10,
    canViewCompleteDecisionReport: true,
    canUseExpandedHistory: true,
    canUseExpandedAnalytics: true,
    checkoutEnabled: true,
  },

  TEAM: {
    code: 'TEAM',
    name: 'Team',
    monthlyAnalysisLimit: null,
    maximumActiveStrategies: null,
    canViewCompleteDecisionReport: true,
    canUseExpandedHistory: true,
    canUseExpandedAnalytics: true,
    checkoutEnabled: true,
  },

  FOUNDER: {
    code: 'FOUNDER',
    name: 'Founder',
    monthlyAnalysisLimit: null,
    maximumActiveStrategies: null,
    canViewCompleteDecisionReport: true,
    canUseExpandedHistory: true,
    canUseExpandedAnalytics: true,
    checkoutEnabled: false,
  },
};

export function planFor(value: unknown): PlanDefinition {
  const plan = String(value ?? 'FREE').toUpperCase() as PlanCode;
  return PLANS[plan] ?? PLANS.FREE;
}