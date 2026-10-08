export type PlanCode =
  | 'FREE'
  | 'PRIVATE_BETA'
  | 'PRO'
  | 'ELITE'
  | 'TEAM'
  | 'FOUNDER';

export const PUBLIC_PLAN_CODES = ['FREE', 'PRO', 'ELITE', 'TEAM'] as const;
export type PublicPlanCode = (typeof PUBLIC_PLAN_CODES)[number];

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

export const PUBLIC_PLAN_PRICING: Record<PublicPlanCode, {
  monthly: string;
  annual: string;
  monthlyAnalysisLimit: number | null;
  maximumActiveStrategies: number | null;
  summary: string;
}> = {
  FREE: {
    monthly: '$0',
    annual: '$0',
    monthlyAnalysisLimit: 15,
    maximumActiveStrategies: 1,
    summary: 'Build discipline with a first strategy and a small evaluation budget.',
  },
  PRO: {
    monthly: '$29 / month',
    annual: '$279 / year',
    monthlyAnalysisLimit: 250,
    maximumActiveStrategies: 5,
    summary: 'For active individual traders who need a reliable review loop.',
  },
  ELITE: {
    monthly: '$59 / month',
    annual: '$569 / year',
    monthlyAnalysisLimit: 1000,
    maximumActiveStrategies: 10,
    summary: 'For highly active traders who need substantially more capacity.',
  },
  TEAM: {
    monthly: '$149 / month',
    annual: '$1,429 / year',
    monthlyAnalysisLimit: null,
    maximumActiveStrategies: null,
    summary: 'For desks, teams, educators, or organizations with shared workflows.',
  },
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
    monthlyAnalysisLimit: 50,
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
