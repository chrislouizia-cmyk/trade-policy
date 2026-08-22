import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { publicApiError } from '@/lib/server/public-error';
import { isTradeLifecycleSimulationEnabled } from '@/lib/server/trade-lifecycle-v2';

const INTERNAL_LIFECYCLE_TAG = 'INTERNAL_LIFECYCLE_SMOKE_TEST';
const INTERNAL_LIFECYCLE_PERMISSION = 'system.health';

const requestSchema = z.object({
  scenario: z.enum(['READY', 'SOFT_BLOCK', 'HARD_BLOCK']),
  instrument: z.string().trim().min(1).default('XAUUSD'),
  direction: z.enum(['BUY', 'SELL']).default('BUY'),
  entry: z.coerce.number(),
  stopLoss: z.coerce.number(),
  takeProfit: z.coerce.number(),
  riskPercent: z.coerce.number().positive().default(0.5),
}).strict();

async function buildInternalSnapshot(scenario: 'READY' | 'SOFT_BLOCK' | 'HARD_BLOCK') {
  const authoritativeVerdict = scenario === 'READY' ? 'READY' : 'BLOCKED';
  const overrideEligible = scenario === 'SOFT_BLOCK';
  const snapshot = {
    schemaVersion: '1.0.0',
    reportId: crypto.randomUUID(),
    verdict: authoritativeVerdict,
    readinessPercent: scenario === 'READY' ? 96 : 46,
    instrument: 'XAUUSD',
    timeframe: '1H',
    strategyName: INTERNAL_LIFECYCLE_TAG,
    strategyRevisionId: 'internal-lifecycle-v2',
    strategyVersion: 'internal-lab-v2',
    primaryReason:
      scenario === 'READY'
        ? 'Internal lifecycle smoke test uses a real READY decision lineage.'
        : scenario === 'SOFT_BLOCK'
          ? 'Internal lifecycle smoke test is blocked but override-enabled.'
          : 'Internal lifecycle smoke test is hard blocked and non-overridable.',
    nextAction:
      scenario === 'READY'
        ? 'ENTRY_READY'
        : scenario === 'SOFT_BLOCK'
          ? 'REVIEW_OVERRIDE'
          : 'BLOCKED',
    marketData: {
      provider: 'INTERNAL_SMOKE_TEST',
      lastVerifiedCandleAt: new Date().toISOString(),
      freshness: 'SIMULATED',
    },
    finalRiskCheck: {
      overrideEligible,
      requiresReview: scenario === 'SOFT_BLOCK',
      riskLevel: scenario === 'READY' ? 'LOW' : 'CONTROLLED',
    },
    decisionSummary: {
      testScenario: scenario,
      source: INTERNAL_LIFECYCLE_TAG,
    },
    createdAt: new Date().toISOString(),
    simulationMode: INTERNAL_LIFECYCLE_TAG,
    internalTestMode: true,
    testSource: INTERNAL_LIFECYCLE_TAG,
  };

  return {
    ...snapshot,
    deterministicFingerprint: (await import('node:crypto')).createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),
  };
}

export async function POST(request: Request) {
  try {
    if (!isTradeLifecycleSimulationEnabled()) {
      return NextResponse.json({ error: 'Trade lifecycle V2 simulation is not enabled.', code: 'TRADE_LIFECYCLE_V2_SIMULATION_DISABLED' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
    }

    const { data: permissionAllowed, error: permissionError } = await supabase.rpc('has_staff_permission', { p_permission: INTERNAL_LIFECYCLE_PERMISSION });
    if (permissionError || !permissionAllowed) {
      return NextResponse.json({ error: 'Forbidden: internal lifecycle simulation requires system health access.', code: 'FORBIDDEN' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
    }

    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid internal lifecycle seed payload.', code: 'INVALID_SEED_PAYLOAD', details: parsed.error.flatten() }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    }

    const { scenario, instrument, direction, entry, stopLoss, takeProfit, riskPercent } = parsed.data;
    const admin = createAdminClient();

    const { data: existingMatch } = await admin
      .from('decision_reports')
      .select('id, snapshot_json, source_analysis_id')
      .eq('user_id', user.id)
      .eq('strategy_name', INTERNAL_LIFECYCLE_TAG)
      .order('created_at', { ascending: false })
      .limit(25);

    const existingCandidate = (existingMatch ?? []).find((row: any) => {
      const snapshot = row?.snapshot_json ?? {};
      return String(snapshot?.decisionSummary?.testScenario ?? '').toUpperCase() === scenario && String(snapshot?.verdict ?? '').toUpperCase() === (scenario === 'READY' ? 'READY' : 'BLOCKED');
    });

    if (existingCandidate?.id && existingCandidate?.source_analysis_id) {
      const { data: existingSource } = await admin
        .from('decision_report_sources')
        .select('id')
        .eq('user_id', user.id)
        .eq('source_analysis_id', existingCandidate.source_analysis_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingSource?.id) {
        return NextResponse.json({
          sourceDecisionId: existingSource.id,
          sourceReportId: existingCandidate.id,
          authoritativeVerdict: scenario === 'READY' ? 'READY' : 'BLOCKED',
          overrideEligible: scenario === 'SOFT_BLOCK',
        }, { headers: { 'Cache-Control': 'no-store' } });
      }
    }

    const snapshot = await buildInternalSnapshot(scenario);
    const sourceDecisionId = crypto.randomUUID();
    const reportId = snapshot.reportId;
    const analysisId = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    const { error: scanError } = await admin.from('market_scans').insert({
      id: analysisId,
      user_id: user.id,
      strategy_profile_id: null,
      instrument,
      provider: 'INTERNAL_SMOKE_TEST',
      timeframes: ['1H'],
      analysis: {
        source: INTERNAL_LIFECYCLE_TAG,
        scenario,
        authoritativeVerdict: snapshot.verdict,
        overrideEligible: snapshot.finalRiskCheck.overrideEligible,
      },
      created_at: createdAt,
    });

    if (scanError) {
      throw new Error(`Could not create the market scan seed for ${scenario}: ${scanError.message}`);
    }

    const { error: sourceError } = await admin.from('decision_report_sources').insert({
      id: sourceDecisionId,
      user_id: user.id,
      source_analysis_id: analysisId,
      strategy_id: null,
      schema_version: snapshot.schemaVersion,
      deterministic_fingerprint: snapshot.deterministicFingerprint,
      snapshot_json: snapshot,
      ai_explanation_json: null,
      created_at: createdAt,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });

    if (sourceError) {
      throw new Error(`Could not create the decision source seed for ${scenario}: ${sourceError.message}`);
    }

    const { error: reportError } = await admin.from('decision_reports').insert({
      id: reportId,
      user_id: user.id,
      schema_version: snapshot.schemaVersion,
      verdict: snapshot.verdict,
      readiness_percent: snapshot.readinessPercent,
      instrument,
      timeframe: snapshot.timeframe,
      strategy_id: null,
      strategy_name: snapshot.strategyName,
      strategy_revision_id: snapshot.strategyRevisionId,
      strategy_version: snapshot.strategyVersion,
      primary_reason: snapshot.primaryReason,
      next_action: snapshot.nextAction,
      market_provider: snapshot.marketData.provider,
      last_verified_candle_at: snapshot.marketData.lastVerifiedCandleAt,
      data_freshness: snapshot.marketData.freshness,
      deterministic_fingerprint: snapshot.deterministicFingerprint,
      snapshot_json: snapshot,
      source_analysis_id: analysisId,
      source_trade_id: null,
      idempotency_key: `internal-lifecycle-${scenario.toLowerCase()}-${Date.now()}-${crypto.randomUUID()}`,
      created_at: createdAt,
    });

    if (reportError) {
      throw new Error(`Could not create the decision report seed for ${scenario}: ${reportError.message}`);
    }

    const response = {
      sourceDecisionId,
      sourceReportId: reportId,
      authoritativeVerdict: snapshot.verdict,
      overrideEligible: snapshot.finalRiskCheck.overrideEligible,
    };

    return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return publicApiError({
      message: 'The internal lifecycle test lineage could not be created.',
      code: 'INTERNAL_LIFECYCLE_SEED_FAILED',
      internalCode: 'INTERNAL_LIFECYCLE_SEED_FAILED',
      endpoint: '/api/internal/lifecycle-test/seed',
      error,
    });
  }
}
