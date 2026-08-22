import 'server-only';

export const INTERNAL_LIFECYCLE_SMOKE_TEST_MODE = 'INTERNAL_LIFECYCLE_SMOKE_TEST' as const;

export function isTradeLifecycleV2Enabled(): boolean {
  const value = process.env.TRADE_LIFECYCLE_V2 ?? process.env.NEXT_PUBLIC_TRADE_LIFECYCLE_V2;
  return value === '1' || value === 'true' || value === 'enabled';
}

export function isTradeLifecycleSimulationEnabled(): boolean {
  const value = process.env.TRADE_LIFECYCLE_V2_SIMULATION ?? process.env.NEXT_PUBLIC_TRADE_LIFECYCLE_V2_SIMULATION;
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['1', 'true', 'enabled', 'on'].includes(normalized);
}

export function isTradeLifecycleSimulationRequest(input: Request | URL | string | { url?: string }): boolean {
  if (!isTradeLifecycleSimulationEnabled()) return false;

  const value = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : typeof input?.url === 'string'
        ? input.url
        : '';

  if (!value) return false;

  const url = new URL(value, 'https://tradepolice.app');
  const flag = url.searchParams.get('internal_test')
    ?? url.searchParams.get('smoke_test')
    ?? url.searchParams.get('internal')
    ?? url.searchParams.get('admin_test');

  if (!flag) return false;
  return ['1', 'true', 'enabled', 'on', 'internal', 'admin'].includes(String(flag).trim().toLowerCase());
}

export function isTradeLifecycleSimulationRecord(row: { strategy_snapshot?: Record<string, unknown> | null; simulation_mode?: string | null; source?: string | null } | null | undefined): boolean {
  if (!row) return false;
  const snapshot = row.strategy_snapshot ?? {};
  const simulationMode = row.simulation_mode ?? snapshot.simulationMode ?? snapshot.testSource ?? snapshot.internalTestMode;
  return simulationMode === INTERNAL_LIFECYCLE_SMOKE_TEST_MODE || row.source === 'SIMULATION';
}

export function getTradeLifecycleSimulationLabel(row: { strategy_snapshot?: Record<string, unknown> | null; simulation_mode?: string | null; source?: string | null } | null | undefined): string {
  return isTradeLifecycleSimulationRecord(row) ? 'SIMULATION / INTERNAL TEST' : 'LIVE';
}

export function attachTradeLifecycleSimulationMetadata<T extends Record<string, unknown> | null | undefined>(input: T): T & {
  simulationMode: typeof INTERNAL_LIFECYCLE_SMOKE_TEST_MODE;
  internalTestMode: true;
  testSource: typeof INTERNAL_LIFECYCLE_SMOKE_TEST_MODE;
} {
  const snapshot = (input && typeof input === 'object' ? { ...input } : {}) as Record<string, unknown>;
  return {
    ...snapshot,
    simulationMode: INTERNAL_LIFECYCLE_SMOKE_TEST_MODE,
    internalTestMode: true,
    testSource: INTERNAL_LIFECYCLE_SMOKE_TEST_MODE,
  } as T & { simulationMode: typeof INTERNAL_LIFECYCLE_SMOKE_TEST_MODE; internalTestMode: true; testSource: typeof INTERNAL_LIFECYCLE_SMOKE_TEST_MODE };
}

export type TradeLifecycleV2ActivationMode = 'READY' | 'OVERRIDE';

export type TradeLifecycleV2ActivationRequest = {
  accountId?: string | null;
  strategyProfileId?: string | null;
  strategyRevisionId?: string | null;
  sourceDecisionId?: string | null;
  sourceReportId?: string | null;
  instrument: string;
  direction: 'BUY' | 'SELL';
  entry: number;
  stopLoss: number;
  takeProfit: number;
  riskPercent?: number | null;
  initialRR?: number | null;
  setupType?: string | null;
  initialScore?: number | null;
  initialAnalysis?: unknown | null;
  originalVerdict?: string | null;
  originalVerdictReason?: string | null;
  overrideReason?: string | null;
  overrideConditions?: unknown[] | null;
  activationMode?: TradeLifecycleV2ActivationMode;
  takenAgainstVerdict?: boolean;
  highImpactNews?: boolean;
  strategySnapshot?: Record<string, unknown> | null;
};

export function buildTradeLifecycleV2ActivationMode(input: { activationMode?: string | null; originalVerdict?: string | null; overrideReason?: string | null }): TradeLifecycleV2ActivationMode {
  if (input.activationMode === 'OVERRIDE') return 'OVERRIDE';
  if (input.originalVerdict && ['WAIT', 'BLOCKED', 'REJECTED'].includes(String(input.originalVerdict))) {
    return input.overrideReason ? 'OVERRIDE' : 'READY';
  }
  return 'READY';
}
