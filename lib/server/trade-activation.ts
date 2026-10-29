export type TradeActionIntent = 'USE_SETUP' | 'TAKE_TRADE' | 'MISSED';

export interface ActiveTradeInsertInput {
  userId: string;
  accountId?: string | null;
  balanceAtEntry?: number | null;
  riskAmount?: number | null;
  strategyProfileId?: string | null;
  strategyNameAtEntry?: string | null;
  strategyVersion?: string | null;
  strategyRevisionId?: string | null;
  tradeRecordId?: string | null;
  sourceDecisionId?: string | null;
  sourceReportId?: string | null;
  instrument: string;
  direction: string;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  riskPercent: number;
  initialRR: number;
  setupType?: string | null;
  initialScore?: number | null;
  initialAnalysis?: unknown | null;
  takenAgainstVerdict?: boolean;
  originalVerdict?: string | null;
  originalVerdictReason?: string | null;
  overrideReason?: string | null;
  overrideConditions?: unknown[] | null;
  activationMode?: 'READY' | 'OVERRIDE';
  createdAt?: string;
  updatedAt?: string;
}

export function buildActiveTradeRow(input: ActiveTradeInsertInput) {
  return {
    user_id: input.userId,
    account_id: input.accountId ?? null,
    balance_at_entry: input.balanceAtEntry ?? null,
    risk_amount: input.riskAmount ?? null,
    strategy_profile_id: input.strategyProfileId ?? null,
    strategy_name_at_entry: input.strategyNameAtEntry ?? null,
    strategy_version: input.strategyVersion ?? null,
    strategy_revision_id: input.strategyRevisionId ?? null,
    trade_record_id: input.tradeRecordId ?? null,
    source_decision_id: input.sourceDecisionId ?? null,
    source_report_id: input.sourceReportId ?? null,
    instrument: input.instrument,
    direction: input.direction,
    entry: input.entry,
    stop_loss: input.stopLoss,
    take_profit: input.takeProfit,
    risk_percent: input.riskPercent,
    initial_rr: input.initialRR,
    setup_type: input.setupType ?? null,
    initial_score: input.initialScore ?? null,
    initial_analysis: input.initialAnalysis ?? null,
    status: 'OPEN' as const,
    current_price: input.entry,
    current_r: 0,
    mfe_r: 0,
    mae_r: 0,
    taken_against_verdict: Boolean(input.takenAgainstVerdict),
    original_verdict: input.originalVerdict ?? null,
    original_verdict_reason: input.originalVerdictReason ?? null,
    override_reason: input.overrideReason ?? null,
    override_conditions: Array.isArray(input.overrideConditions) ? input.overrideConditions : [],
    activation_mode: input.activationMode ?? 'READY',
    opened_at: input.createdAt ?? new Date().toISOString(),
    updated_at: input.updatedAt ?? new Date().toISOString(),
  };
}

export function shouldCreateActiveTradeForAction(intent: TradeActionIntent): boolean {
  return intent === 'TAKE_TRADE';
}
