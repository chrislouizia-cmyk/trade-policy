import { NextResponse } from 'next/server';
import { publicApiError } from '@/lib/server/public-error';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { canActivateTradeFromDecision, evaluateTradeAuthorizationEligibility } from '@/lib/server/trade-lifecycle';
import { buildActiveTradeRow } from '@/lib/server/trade-activation';
import { historicalDecisionSnapshotV1Schema } from '@/lib/historical-decisions/schema';
import { deterministicFingerprint } from '@/lib/historical-decisions/fingerprint';

export async function POST(request: Request) {
  let cleanup:{supabase:Awaited<ReturnType<typeof createClient>>;userId:string;tradeRecordId:string}|null=null;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    const body = await request.json();
    const mode = body.mode === 'MISSED' ? 'MISSED' : 'ACTIVATE';
    const overrideIntent = body.activationMode === 'OVERRIDE';
    let allowOverride=false;
    if(overrideIntent){
      if(typeof body.sourceDecisionId!=='string')return NextResponse.json({error:'Re-run Final Risk Check before overriding.'},{status:409});
      const {data:source,error:sourceError}=await supabase.from('decision_report_sources').select('snapshot_json,user_id').eq('id',body.sourceDecisionId).eq('user_id',user.id).maybeSingle();
      if(sourceError)throw sourceError;
      const parsed=historicalDecisionSnapshotV1Schema.safeParse(source?.snapshot_json);
      const snapshot=parsed.success?parsed.data:null;
      if(!snapshot||snapshot.userId!==user.id||deterministicFingerprint(snapshot as unknown as Record<string,unknown>)!==snapshot.deterministicFingerprint)return NextResponse.json({error:'This decision was created before authoritative override eligibility was available. Re-run Final Risk Check before overriding.'},{status:409});
      if(snapshot.finalRiskCheck?.overrideEligible!==true)return NextResponse.json({error:'This decision is blocked by non-overrideable risk controls.',overrideBlockers:snapshot.finalRiskCheck?.overrideBlockers??[]},{status:409});
      allowOverride=true;
    }
    const entry = Number(body.entry), stopLoss = Number(body.stopLoss), takeProfit = Number(body.takeProfit);
    const riskPercent = Number(body.riskPercent ?? 0.5), initialRR = Number(body.initialRR);
    if (!body.instrument || !['BUY','SELL'].includes(body.direction) || typeof body.highImpactNews !== 'boolean' || ![entry,stopLoss,takeProfit,riskPercent,initialRR].every(Number.isFinite)) {
      return NextResponse.json({ error: 'Missing or invalid trade information.' }, { status: 400 });
    }
    if(body.tradeRecordId&&typeof body.tradeRecordId==='string')cleanup={supabase,userId:user.id,tradeRecordId:body.tradeRecordId};

    const decisionCheck = canActivateTradeFromDecision({
      verdict: body.originalVerdict ?? body.verdict ?? 'READY',
      analysisStatus: body.analysisStatus ?? 'VALID_ANALYSIS',
      strategyActive: body.strategyActive ?? true,
      alreadyConverted: Boolean(body.alreadyConverted),
      decisionOwnerId: body.decisionOwnerId ?? user.id,
      currentUserId: user.id,
      decisionInstrument: body.decisionInstrument ?? body.instrument,
      decisionDirection: body.decisionDirection ?? body.direction,
      requestedInstrument: body.instrument,
      requestedDirection: body.direction,
      sourceDecisionId: typeof body.sourceDecisionId === 'string' ? body.sourceDecisionId : undefined,
      sourceReportId: typeof body.sourceReportId === 'string' ? body.sourceReportId : undefined,
      readinessPercentage: typeof body.readinessPercentage === 'number' ? body.readinessPercentage : undefined,
      missingMandatoryConfirmations: Array.isArray(body.missingMandatoryConfirmations) ? body.missingMandatoryConfirmations : undefined,
      overrideReason: typeof body.overrideReason === 'string' ? body.overrideReason : undefined,
    }, { allowOverride });

    if (mode === 'MISSED') {
      if (body.tradeRecordId) {
        await supabase.from('trade_records').update({
          status: 'CLOSED',
          verdict: 'MISSED',
          outcome: 'BREAKEVEN',
          updated_at: new Date().toISOString(),
        }).eq('id', body.tradeRecordId).eq('user_id', user.id);
      }
      return NextResponse.json({ status: 'MISSED', createActiveTrade: false, decisionCheck, rejection: { reasonCode: 'MISSED', message: 'The decision was recorded as missed without creating an active trade.', state: 'READY' } });
    }

    if (!decisionCheck.allowed) {
      const eligibility = evaluateTradeAuthorizationEligibility({
        verdict: body.originalVerdict ?? body.verdict ?? 'READY',
        analysisStatus: body.analysisStatus ?? 'VALID_ANALYSIS',
        strategyActive: body.strategyActive ?? true,
        alreadyConverted: Boolean(body.alreadyConverted),
        decisionOwnerId: body.decisionOwnerId ?? user.id,
        currentUserId: user.id,
        decisionInstrument: body.decisionInstrument ?? body.instrument,
        decisionDirection: body.decisionDirection ?? body.direction,
        requestedInstrument: body.instrument,
        requestedDirection: body.direction,
        sourceDecisionId: typeof body.sourceDecisionId === 'string' ? body.sourceDecisionId : undefined,
        sourceReportId: typeof body.sourceReportId === 'string' ? body.sourceReportId : undefined,
        readinessPercentage: typeof body.readinessPercentage === 'number' ? body.readinessPercentage : undefined,
        missingMandatoryConfirmations: Array.isArray(body.missingMandatoryConfirmations) ? body.missingMandatoryConfirmations : undefined,
        overrideReason: typeof body.overrideReason === 'string' ? body.overrideReason : undefined,
      });
      console.error('[TRADE_AUTHORIZATION_REJECTED]', { reasonCode: eligibility.reasonCode, message: eligibility.message, verdict: body.originalVerdict ?? body.verdict ?? 'READY' });
      return NextResponse.json({ error: eligibility.message, rejection: { reasonCode: eligibility.reasonCode, message: eligibility.message, state: eligibility.state } }, { status: 409 });
    }

    const { data: existing, error: existingError } = await supabase.from('active_trades').select('id').eq('user_id', user.id).eq('instrument', body.instrument).eq('status','OPEN').maybeSingle();
    if (existingError) throw existingError;
    if (existing) {
      if(cleanup)await cleanup.supabase.from('trade_records').delete().eq('id',cleanup.tradeRecordId).eq('user_id',cleanup.userId).eq('source','EXECUTED').eq('status','OPEN');
      return NextResponse.json({ error: 'You already have an open trade for this instrument.', rejection: { reasonCode: 'TRADE_ALREADY_ACTIVATED', message: 'You already have an open trade for this instrument.', state: 'BLOCKED' } }, { status: 409 });
    }

    const { data: sourceDecision, error: sourceDecisionError } = await supabase.from('decision_report_sources').select('id,user_id').eq('id', body.sourceDecisionId).eq('user_id', user.id).maybeSingle();
    if (sourceDecisionError) throw sourceDecisionError;
    if (!sourceDecision && body.sourceDecisionId) {
      return NextResponse.json({ error: 'The originating decision could not be verified.', rejection: { reasonCode: 'SOURCE_DECISION_MISSING', message: 'The originating decision could not be verified.', state: 'BLOCKED' } }, { status: 409 });
    }

    if (body.sourceReportId) {
      const { data: sourceReport, error: sourceReportError } = await supabase.from('decision_reports').select('id,user_id').eq('id', body.sourceReportId).eq('user_id', user.id).maybeSingle();
      if (sourceReportError) throw sourceReportError;
      if (!sourceReport) {
        return NextResponse.json({ error: 'The originating decision report could not be verified.', rejection: { reasonCode: 'SOURCE_REPORT_MISSING', message: 'The originating decision report could not be verified.', state: 'BLOCKED' } }, { status: 409 });
      }
    }

    const admin = createAdminClient();
    const { data: privilegeProbe, error: privilegeProbeError } = await admin
      .from('active_trades')
      .select('id')
      .limit(1);

    console.log('[TRADE_ADMIN_PRIVILEGE_PROBE]', {
      success: !privilegeProbeError,
      errorCode: privilegeProbeError?.code ?? null,
      errorMessage: privilegeProbeError?.message ?? null,
      rowsReturned: Array.isArray(privilegeProbe) ? privilegeProbe.length : null,
      selectedKeySource: process.env.SUPABASE_SERVICE_ROLE_KEY
        ? 'SUPABASE_SERVICE_ROLE_KEY'
        : process.env.SUPABASE_SECRET_KEY
          ? 'SUPABASE_SECRET_KEY'
          : 'UNSET',
      rpcName: 'activate_trade_atomically_v1',
      deploymentCommitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    });

    const response = await admin.rpc('activate_trade_atomically_v1', {
      p_user_id: user.id,
      p_account_id: body.accountId ?? null,
      p_balance_at_entry: body.balanceAtEntry ?? null,
      p_risk_amount: body.riskAmount ?? null,
      p_strategy_profile_id: body.strategyProfileId ?? null,
      p_strategy_name_at_entry: body.strategyNameAtEntry ?? null,
      p_strategy_version: typeof body.strategySnapshot?.version === 'string' ? body.strategySnapshot.version : (typeof body.strategySnapshot?.engineVersion === 'number' ? String(body.strategySnapshot.engineVersion) : null),
      p_strategy_revision_id: typeof body.strategySnapshot?.revisionId === 'string' ? body.strategySnapshot.revisionId : null,
      p_source_decision_id: typeof body.sourceDecisionId === 'string' ? body.sourceDecisionId : null,
      p_source_report_id: typeof body.sourceReportId === 'string' ? body.sourceReportId : null,
      p_instrument: body.instrument,
      p_direction: body.direction,
      p_entry: entry,
      p_stop_loss: stopLoss,
      p_take_profit: takeProfit,
      p_risk_percent: riskPercent,
      p_initial_rr: initialRR,
      p_setup_type: body.setupType ?? null,
      p_initial_score: body.initialScore ?? null,
      p_initial_analysis: body.initialAnalysis ?? null,
      p_taken_against_verdict: Boolean(body.takenAgainstVerdict),
      p_original_verdict: body.originalVerdict ?? null,
      p_original_verdict_reason: body.originalVerdictReason ?? null,
      p_override_reason: body.overrideReason ?? null,
      p_override_conditions: Array.isArray(body.overrideConditions) ? body.overrideConditions : [],
      p_activation_mode: body.activationMode === 'OVERRIDE' ? 'OVERRIDE' : 'READY',
      p_high_impact_news: Boolean(body.highImpactNews),
      p_strategy_snapshot: { ...(body.strategySnapshot ?? {}), tradeContext: { highImpactNews: Boolean(body.highImpactNews) } },
    });

    if (response.error) throw response.error;
    const activation = response.data as { trade_record_id?: string; trade_id?: string; active_trade_id?: string; lifecycle_status?: string; active_trade_created?: boolean; audit_event_recorded?: boolean } | null;
    if (!activation || typeof activation.trade_record_id !== 'string' || typeof activation.active_trade_id !== 'string') {
      throw new Error('Trade activation RPC did not return a valid record set.');
    }

    return NextResponse.json({
      trade: { id: activation.active_trade_id },
      lifecycleStatus: activation.lifecycle_status ?? decisionCheck.status,
      activeTradeCreated: activation.active_trade_created === true,
      auditEventRecorded: activation.audit_event_recorded !== false,
      decisionCheck,
      tradeRecordId: activation.trade_record_id,
      activeTradeId: activation.active_trade_id,
    });
  } catch (error) {
    if(cleanup&&error&&typeof error==='object'&&'code' in error&&(error as {code?:string}).code==='23505'){
      await cleanup.supabase.from('trade_records').delete().eq('id',cleanup.tradeRecordId).eq('user_id',cleanup.userId).eq('source','EXECUTED').eq('status','OPEN');
      return NextResponse.json({error:'This trade is already open. The duplicate request was not recorded.'},{status:409});
    }
    return publicApiError({message:'We could not record this trade. Please try again.',code:'TRADE_SAVE_FAILED',internalCode:'TRADE_SAVE_FAILED',endpoint:'/app/api/trades/take',error});
  }
}
