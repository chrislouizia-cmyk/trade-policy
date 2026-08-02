import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { loadActiveStrategy } from '@/lib/server/active-strategy';
import { loadDailyTradeContext } from '@/lib/server/daily-trade-context';
import { validateTradeWithStrategy } from '@/lib/server/decision-engine';
import { buildDecisionNarrative } from '@/lib/intelligence/decision-narrative';
import { enhanceDecisionNarrative } from '@/lib/server/decision-narrative-ai';
import { apiError } from '@/lib/server/public-error';
import type { ChartAnalysis, TradeInput } from '@/types/trade';
import { confirmationState } from '@/lib/manual-confirmations';
import { applyTradingDnaRuntime, buildTradingDnaRuntimeContext, evaluateTradingDnaRuntime } from '@/lib/trading-dna/runtime';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildDecisionExplanation } from '@/lib/intelligence/decision-explanation';
import { buildHistoricalDecisionSnapshot } from '@/lib/historical-decisions/build';
import { historicalDecisionSnapshotV1Schema } from '@/lib/historical-decisions/schema';
import { strategyRevisionId } from '@/lib/historical-decisions/strategy-revision';
import { recordReportFailure } from '@/lib/historical-decisions/operations';

export const dynamic = 'force-dynamic';

const schema = z.object({
  analysisId: z.string().uuid(),
  instrument: z.string().trim().min(1).max(30),
  direction: z.enum(['BUY', 'SELL']),
  entry: z.number().finite(),
  stopLoss: z.number().finite(),
  takeProfit: z.number().finite(),
  accountBalance: z.number().positive().finite(),
  accountId: z.string().uuid().nullable().optional(),
  userTimezone: z.string().trim().min(1).max(100).optional(),
  riskPercent: z.number().positive().finite(),
  tradesToday: z.number().int().min(0),
  session: z.string().trim().min(1).max(80),
  highImpactNews: z.boolean(),
  h4TrendAligned: z.boolean(),
  h1TrendAligned: z.boolean(),
  structurePattern: z.boolean(),
  liquiditySweep: z.boolean(),
  chochConfirmed: z.boolean(),
  bosConfirmed: z.boolean(),
  orderBlock: z.boolean(),
  fairValueGap: z.boolean(),
  retestConfirmed: z.boolean(),
  setupType: z.string().trim().max(120).optional(),
  setupConfidence: z.number().min(0).max(100).optional(),
  manualConfirmations:z.array(z.object({evidenceKey:z.string().trim().min(1).max(4000),state:z.enum(['PENDING','CONFIRMED','FAILED']).optional(),confirmed:z.boolean().optional(),note:z.string().max(240).optional()}).refine(value=>value.state!==undefined||value.confirmed!==undefined,{message:'Manual confirmation state required.'})).optional().default([]),
});

export async function POST(request: Request) {
  const requestId=crypto.randomUUID();
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return apiError('UNAUTHORIZED','Unauthorized.',401);
    }

    const parsed = schema.safeParse(await request.json().catch(()=>null));
    if (!parsed.success) {
      return apiError('INVALID_TRADE','Some trade values are invalid.',400,parsed.error.flatten());
    }

    const strategy = await loadActiveStrategy(supabase, user.id);
    const {data:scan,error:scanError}=await supabase.from('market_scans').select('id,user_id,strategy_profile_id,strategy_revision_id,instrument,analysis,server_created').eq('id',parsed.data.analysisId).eq('user_id',user.id).maybeSingle();
    if(scanError||!scan||!scan.server_created)return apiError('ANALYSIS_NOT_FOUND','The verified market analysis could not be found. Run the market check again.',409);
    if(scan.strategy_profile_id!==strategy.id||scan.strategy_revision_id!==strategyRevisionId(strategy)||scan.instrument!==parsed.data.instrument){await recordReportFailure({reasonCode:'STRATEGY_REVISION_MISMATCH',requestId,userId:user.id,sourceAnalysisId:scan.id,retryable:false});return apiError('ANALYSIS_CONTEXT_CHANGED','The market analysis no longer matches the active trading rules. Run the market check again.',409)}
    const authoritativeAnalysis=scan.analysis as ChartAnalysis;
    if(!authoritativeAnalysis||!['VALID_ANALYSIS','NO_RELEVANT_EVIDENCE'].includes(authoritativeAnalysis.analysisStatus)||authoritativeAnalysis.instrument!==parsed.data.instrument)return apiError('ANALYSIS_NOT_VALID','A completed verified market analysis is required.',409);
    const dailyContext = await loadDailyTradeContext({
      supabase,
      userId: user.id,
      strategy,
      instrument: parsed.data.instrument,
      accountId: parsed.data.accountId,
      timezone: parsed.data.userTimezone || 'UTC',
    });
    const manualRuleKeys=new Set((strategy.rules??[]).filter(rule=>rule.enabled&&rule.evaluationMode==='MANUAL').map(rule=>rule.ruleKey));
    const invalidManual=parsed.data.manualConfirmations.find(item=>!manualRuleKeys.has(item.evidenceKey));
    if(invalidManual)return apiError('INVALID_MANUAL_CONFIRMATION',invalidManual.evidenceKey+' is not configured as a manual rule.',400);
    const normalizedConfirmations=parsed.data.manualConfirmations.map(item=>({...item,state:confirmationState(item)}));
    const input={...parsed.data,setupType:authoritativeAnalysis.setupType,setupConfidence:authoritativeAnalysis.liveAnalysisConfidence??undefined,manualConfirmations:normalizedConfirmations} as TradeInput;
    for(const key of ['h4TrendAligned','h1TrendAligned','structurePattern','liquiditySweep','chochConfirmed','bosConfirmed','orderBlock','fairValueGap','retestConfirmed'] as const)input[key]=authoritativeAnalysis.evidence[key].value;
    const evidenceKeys=new Set(['h4TrendAligned','h1TrendAligned','structurePattern','liquiditySweep','chochConfirmed','bosConfirmed','orderBlock','fairValueGap','retestConfirmed']);
    for(const item of normalizedConfirmations)if(evidenceKeys.has(item.evidenceKey))(input as unknown as Record<string,unknown>)[item.evidenceKey]=item.state==='CONFIRMED';
    const legacyDecisionStrategy={...strategy,rules:(strategy.rules??[]).filter(rule=>!rule.ruleKey.startsWith('dna.v1.'))};
    const baseResult = validateTradeWithStrategy(input, legacyDecisionStrategy, dailyContext);
    const evidenceReport=evaluateTradingDnaRuntime(strategy.rules,buildTradingDnaRuntimeContext(input,strategy));
    const result=applyTradingDnaRuntime(baseResult,evidenceReport);
    const deterministicNarrative = buildDecisionNarrative({
      result,
      strategy,
      input: input as TradeInput,
    });
    let decisionNarrative = deterministicNarrative;
    try {
      decisionNarrative = await enhanceDecisionNarrative(deterministicNarrative);
    } catch (narrativeError) {
      console.error('Decision narrative error:', narrativeError);
    }

    const explanation=buildDecisionExplanation({analysis:authoritativeAnalysis,result,narrative:decisionNarrative,evidenceReport,strategy});
    let snapshot:ReturnType<typeof buildHistoricalDecisionSnapshot>,validatedSnapshot:ReturnType<typeof historicalDecisionSnapshotV1Schema.parse>;
    try{snapshot=buildHistoricalDecisionSnapshot({userId:user.id,analysis:authoritativeAnalysis,strategy,input,result,explanation});validatedSnapshot=historicalDecisionSnapshotV1Schema.parse(snapshot)}catch{await recordReportFailure({reasonCode:'FINGERPRINT_FAILURE',requestId,userId:user.id,sourceAnalysisId:scan.id,retryable:false});return apiError('REPORT_SNAPSHOT_FAILED','The decision was completed but its historical snapshot could not be prepared. No report was saved.',503)}
    const aiParts=decisionNarrative.source==='AI_ENHANCED'?[decisionNarrative.educationalExplanation,decisionNarrative.coachingMessage,decisionNarrative.learningTip].filter((part):part is string=>Boolean(part?.trim())):[];
    const aiExplanation=aiParts.length?{reportId:snapshot.reportId,explanationVersion:'1',provider:'OpenAI',...(process.env.OPENAI_MODEL?{model:process.env.OPENAI_MODEL}:{}),prose:aiParts.join('\n\n'),createdAt:new Date().toISOString(),sourceVerdict:snapshot.verdict,sourceDeterministicFingerprint:snapshot.deterministicFingerprint,authoritative:false}:null;
    const {data:source,error:sourceError}=await createAdminClient().from('decision_report_sources').insert({user_id:user.id,source_analysis_id:scan.id,strategy_id:strategy.id,schema_version:snapshot.schemaVersion,deterministic_fingerprint:snapshot.deterministicFingerprint,snapshot_json:validatedSnapshot,ai_explanation_json:aiExplanation}).select('id,expires_at').single();
    if(sourceError||!source)throw sourceError??new Error('Decision report source was not created.');

    return NextResponse.json(
      {
        ...result,
        strategy: {
          id: strategy.id,
          name: strategy.name,
          engineVersion:strategy.engineVersion??1,
        },
        manualConfirmations:normalizedConfirmations,
        evidenceReport,
        decisionNarrative,
        reportSourceId:source.id,
        reportSourceExpiresAt:source.expires_at,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('Validation error:', error);
    return apiError('VALIDATION_FAILED','Trade authorization could not be completed. Your trade data was not changed.',503);
  }
}
