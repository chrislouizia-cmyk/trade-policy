import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { publicApiError } from '@/lib/server/public-error';
import { attachTradeLifecycleSimulationMetadata, isTradeLifecycleSimulationRequest, isTradeLifecycleV2Enabled } from '@/lib/server/trade-lifecycle-v2';

const requestSchema = z.object({
  accountId: z.string().uuid().nullable().optional(),
  strategyProfileId: z.string().uuid().nullable().optional(),
  strategyRevisionId: z.string().nullable().optional(),
  sourceDecisionId: z.string().uuid(),
  sourceReportId: z.string().uuid(),
  instrument: z.string().min(1),
  direction: z.enum(['BUY', 'SELL']),
  entry: z.coerce.number(),
  stopLoss: z.coerce.number(),
  takeProfit: z.coerce.number(),
  riskPercent: z.coerce.number().positive().default(0.5),
  initialRR: z.coerce.number().optional().default(1),
  setupType: z.string().nullable().optional(),
  initialScore: z.coerce.number().nullable().optional(),
  initialAnalysis: z.any().nullable().optional(),
  originalVerdict: z.string().nullable().optional(),
  originalVerdictReason: z.string().nullable().optional(),
  overrideReason: z.string().nullable().optional(),
  overrideConditions: z.array(z.any()).nullable().optional(),
  activationMode: z.enum(['READY', 'OVERRIDE']).optional().default('READY'),
  takenAgainstVerdict: z.coerce.boolean().optional().default(false),
  highImpactNews: z.coerce.boolean().optional().default(false),
  strategySnapshot: z.any().nullable().optional(),
}).passthrough().refine((payload) => payload.activationMode !== 'OVERRIDE' || Boolean(payload.overrideReason?.trim()), {
  message: 'overrideReason is required when activationMode is OVERRIDE.',
  path: ['overrideReason'],
});

export async function POST(request: Request) {
  try {
    if (!isTradeLifecycleV2Enabled()) {
      return NextResponse.json(
        { error: 'Trade lifecycle V2 is disabled for this environment.', code: 'TRADE_LIFECYCLE_V2_DISABLED' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }

    const json = await request.json();
    const parsed = requestSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({
        error: 'Invalid activation payload.',
        code: 'INVALID_ACTIVATION_PAYLOAD',
        details: parsed.error.flatten(),
      }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    }

    const payload = parsed.data;
    const simulationRequest = isTradeLifecycleSimulationRequest(request);
    const strategySnapshot = simulationRequest
      ? attachTradeLifecycleSimulationMetadata(payload.strategySnapshot ?? {})
      : (payload.strategySnapshot ?? {});

    if (payload.accountId && (!Number.isFinite(payload.riskPercent) || payload.riskPercent <= 0)) {
      return NextResponse.json({
        error: 'riskPercent must be greater than zero for account-backed activation.',
        code: 'INVALID_RISK_PERCENT',
      }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    }

    const admin = createAdminClient();
    const response = await admin.rpc('activate_trade_v2', {
      p_user_id: user.id,
      p_account_id: payload.accountId ?? null,
      p_strategy_profile_id: payload.strategyProfileId ?? null,
      p_strategy_revision_id: payload.strategyRevisionId ?? null,
      p_source_decision_id: payload.sourceDecisionId,
      p_source_report_id: payload.sourceReportId,
      p_instrument: payload.instrument,
      p_direction: payload.direction,
      p_entry: Number(payload.entry),
      p_stop_loss: Number(payload.stopLoss),
      p_take_profit: Number(payload.takeProfit),
      p_risk_percent: Number(payload.riskPercent),
      p_initial_rr: Number(payload.initialRR ?? 1),
      p_setup_type: payload.setupType ?? null,
      p_initial_score: payload.initialScore ?? null,
      p_initial_analysis: payload.initialAnalysis ?? null,
      p_taken_against_verdict: Boolean(payload.takenAgainstVerdict || payload.activationMode === 'OVERRIDE'),
      p_balance_at_entry: payload.accountId ? null : (payload as { balanceAtEntry?: number | null }).balanceAtEntry ?? null,
      p_risk_amount: payload.accountId ? null : (payload as { riskAmount?: number | null }).riskAmount ?? null,
      p_original_verdict: payload.originalVerdict ?? null,
      p_original_verdict_reason: payload.originalVerdictReason ?? null,
      p_override_reason: payload.overrideReason ?? null,
      p_override_conditions: Array.isArray(payload.overrideConditions) ? payload.overrideConditions : [],
      p_activation_mode: payload.activationMode ?? 'READY',
      p_high_impact_news: Boolean(payload.highImpactNews),
      p_strategy_snapshot: strategySnapshot,
    });

    if (response.error) {
      const message = response.error.message || 'The trade could not be activated.';
      const code = response.error.code || 'TRADE_ACTIVATION_FAILED';
      return NextResponse.json({
        error: message,
        code,
      }, { status: code === '23505' ? 409 : 400, headers: { 'Cache-Control': 'no-store' } });
    }

    return NextResponse.json({
      result: response.data,
      route: 'activate_trade_v2',
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return publicApiError({
      message: 'We could not activate this trade. No trade record was created.',
      code: 'TRADE_ACTIVATION_FAILED',
      internalCode: 'TRADE_ACTIVATION_FAILED',
      endpoint: '/api/trades/activate',
      error,
    });
  }
}
