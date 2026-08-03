import { NextResponse } from 'next/server';
import { publicApiError } from '@/lib/server/public-error';
import { createClient } from '@/lib/supabase/server';
import { canActivateTradeFromDecision, evaluateTradeAuthorizationEligibility } from '@/lib/server/trade-lifecycle';

export async function POST(request: Request) {
  let cleanup:{supabase:Awaited<ReturnType<typeof createClient>>;userId:string;tradeRecordId:string}|null=null;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    const body = await request.json();
    const mode = body.mode === 'MISSED' ? 'MISSED' : 'ACTIVATE';
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
    });

    if (mode === 'MISSED') {
      if (body.tradeRecordId) {
        await supabase.from('trade_records').update({
          status: 'CLOSED',
          verdict: 'MISSED',
          outcome: 'BREAKEVEN',
          updated_at: new Date().toISOString(),
        }).eq('id', body.tradeRecordId).eq('user_id', user.id);
      }
      return NextResponse.json({ status: 'MISSED', createActiveTrade: false, decisionCheck });
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
      });
      console.error('[TRADE_AUTHORIZATION_REJECTED]', { reasonCode: eligibility.reasonCode, message: eligibility.message, verdict: body.originalVerdict ?? body.verdict ?? 'READY' });
      return NextResponse.json({ error: 'This decision cannot be authorized into an active trade right now.', rejection: { reasonCode: eligibility.reasonCode, message: eligibility.message, state: eligibility.state } }, { status: 409 });
    }

    const { data: existing, error: existingError } = await supabase.from('active_trades').select('id').eq('user_id', user.id).eq('instrument', body.instrument).eq('status','OPEN').maybeSingle();
    if (existingError) throw existingError;
    if (existing) {
      if(cleanup)await cleanup.supabase.from('trade_records').delete().eq('id',cleanup.tradeRecordId).eq('user_id',cleanup.userId).eq('source','EXECUTED').eq('status','OPEN');
      return NextResponse.json({ error: 'You already have an open trade for this instrument.' }, { status: 409 });
    }

    const { data: sourceDecision, error: sourceDecisionError } = await supabase.from('decision_report_sources').select('id,user_id').eq('id', body.sourceDecisionId).eq('user_id', user.id).maybeSingle();
    if (sourceDecisionError) throw sourceDecisionError;
    if (!sourceDecision && body.sourceDecisionId) {
      return NextResponse.json({ error: 'The originating decision could not be verified.' }, { status: 409 });
    }

    if (body.sourceReportId) {
      const { data: sourceReport, error: sourceReportError } = await supabase.from('decision_reports').select('id,user_id').eq('id', body.sourceReportId).eq('user_id', user.id).maybeSingle();
      if (sourceReportError) throw sourceReportError;
      if (!sourceReport) {
        return NextResponse.json({ error: 'The originating decision report could not be verified.' }, { status: 409 });
      }
    }

    const { data: trade, error } = await supabase.from('active_trades').insert({
      user_id:user.id, account_id:body.accountId ?? null, balance_at_entry:body.balanceAtEntry ?? null, risk_amount:body.riskAmount ?? null, strategy_profile_id:body.strategyProfileId ?? null, strategy_name_at_entry:body.strategyNameAtEntry ?? null, strategy_snapshot:{...(body.strategySnapshot ?? {}),tradeContext:{highImpactNews:body.highImpactNews}}, trade_record_id:body.tradeRecordId ?? null,
      instrument:body.instrument, direction:body.direction, entry, stop_loss:stopLoss, take_profit:takeProfit,
      risk_percent:riskPercent, initial_rr:initialRR, setup_type:body.setupType ?? null, initial_score:body.initialScore ?? null,
      initial_analysis:body.initialAnalysis ?? null, status:'OPEN', current_price:entry, current_r:0, mfe_r:0, mae_r:0,
      taken_against_verdict:Boolean(body.takenAgainstVerdict), original_verdict:body.originalVerdict ?? null,
      original_verdict_reason:body.originalVerdictReason ?? null, override_reason:body.overrideReason ?? null,
      source_decision_id: typeof body.sourceDecisionId === 'string' ? body.sourceDecisionId : null,
      source_report_id: typeof body.sourceReportId === 'string' ? body.sourceReportId : null,
    }).select().single();
    if (error) throw error;
    const {error:eventError}=await supabase.from('active_trade_events').insert({ user_id:user.id, trade_id:trade.id,
      event_type: body.takenAgainstVerdict ? 'TRADE_TAKEN_AGAINST_VERDICT' : 'TRADE_TAKEN',
      verdict: body.takenAgainstVerdict ? `OPEN — AGAINST ${body.originalVerdict ?? 'VERDICT'}` : 'OPEN',
      current_price:entry, current_r:0, analysis:{ original_analysis:body.initialAnalysis ?? null, original_verdict:body.originalVerdict ?? null, original_verdict_reason:body.originalVerdictReason ?? null, override_reason:body.overrideReason ?? null }
    });
    if(eventError)console.error('[ACTIVE_TRADE_EVENT_FAILED]',{tradeId:trade.id,message:eventError.message});
    return NextResponse.json({ trade, auditEventRecorded:!eventError, decisionCheck });
  } catch (error) {
    if(cleanup&&error&&typeof error==='object'&&'code' in error&&(error as {code?:string}).code==='23505'){
      await cleanup.supabase.from('trade_records').delete().eq('id',cleanup.tradeRecordId).eq('user_id',cleanup.userId).eq('source','EXECUTED').eq('status','OPEN');
      return NextResponse.json({error:'This trade is already open. The duplicate request was not recorded.'},{status:409});
    }
    return publicApiError({message:'We could not record this trade. Please try again.',code:'TRADE_SAVE_FAILED',internalCode:'TRADE_SAVE_FAILED',endpoint:'/app/api/trades/take',error});
  }
}
