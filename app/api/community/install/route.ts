import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
const schema = z.object({shareCode: z.string().uuid()});
const ALLOWED = new Set(['baf23429-d2f4-4173-974d-4a4a7b766e3d']);
const fields: Record<string, string> = {
  name:'name', description:'description', instruments:'instruments', marketTypes:'market_types',
  macroTimeframe:'macro_timeframe', trendTimeframe:'trend_timeframe',
  confirmationTimeframe:'confirmation_timeframe', entryTimeframe:'entry_timeframe',
  triggerTimeframe:'trigger_timeframe', minimumRR:'minimum_rr', preferredRR:'preferred_rr',
  maximumRiskPercent:'maximum_risk_percent', maximumTradesPerDay:'maximum_trades_per_day',
  allowedSessions:'allowed_sessions', avoidHighImpactNews:'avoid_high_impact_news',
  requireTrendAlignment:'require_trend_alignment', requiredEvidence:'required_evidence',
  evidenceWeights:'evidence_weights', stopLimits:'stop_limits',
  authorizationScore:'authorization_score', waitScore:'wait_score',
  lossStreakLimit:'loss_streak_limit', newsMode:'news_mode',
  newsBlockMinutesBefore:'news_block_minutes_before', newsBlockMinutesAfter:'news_block_minutes_after',
  newsCurrencies:'news_currencies', preferredSetups:'preferred_setups',
  maximumDailyRiskPercent:'maximum_daily_risk_percent',
  maximumWeeklyRiskPercent:'maximum_weekly_risk_percent',
  maximumDailyLossPercent:'maximum_daily_loss_percent',
  maximumTotalExposurePercent:'maximum_total_exposure_percent',
  maximumCurrencyExposurePercent:'maximum_currency_exposure_percent',
  maximumConsecutiveLosses:'maximum_consecutive_losses',
  tradingStyle:'trading_style', personalRules:'personal_rules',
  aiBehavior:'ai_behavior', engineVersion:'engine_version'
};
type Snapshot = Record<string, unknown>;
type Rule = Record<string, unknown>;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if (value && typeof value==='object') {
    const record=value as Record<string,unknown>;
    return '{'+Object.keys(record).sort().map(key=>JSON.stringify(key)+':'+canonical(record[key])).join(',')+'}';
  }
  return JSON.stringify(value) ?? 'null';
}
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {data:{user}} = await supabase.auth.getUser();
    if (!user) return NextResponse.json({error:'Sign in to install strategies.'},{status:401});
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success || !ALLOWED.has(parsed.data.shareCode)) {
      return NextResponse.json({error:'Strategy unavailable.'},{status:404});
    }
    const admin = createAdminClient();
    const {data:share,error:shareError} = await admin.from('strategy_shares')
      .select('id,current_version,license_code,status')
      .eq('share_code',parsed.data.shareCode).eq('status','ACTIVE').maybeSingle();
    if (shareError || !share || share.license_code !== 'PERSONAL_USE_V1') {
      return NextResponse.json({error:'Strategy unavailable.'},{status:404});
    }
    const {data:version,error:versionError} = await admin.from('strategy_share_versions')
      .select('snapshot_json').eq('share_id',share.id).eq('version',share.current_version).maybeSingle();
    if (versionError || !version) return NextResponse.json({error:'Strategy version unavailable.'},{status:404});
    const snapshot = version.snapshot_json as Snapshot;
    if (typeof snapshot.name !== 'string' || !Array.isArray(snapshot.instruments)
      || !snapshot.instruments.length || !Array.isArray(snapshot.rules) || !snapshot.rules.length) {
      return NextResponse.json({error:'Invalid shared strategy.'},{status:422});
    }
    const profile: Record<string,unknown> = {};
    for (const [source,target] of Object.entries(fields)) {
      if (snapshot[source] !== undefined && snapshot[source] !== null) profile[target] = snapshot[source];
    }
    profile.name = String(snapshot.name).slice(0,100);
    profile.is_archived = false;
    const instruments = snapshot.instruments.filter((s):s is string=>typeof s==='string' && /^[A-Z0-9._-]{3,20}$/.test(s))
      .slice(0,20).map((symbol,index)=>({
        symbol,market_type:symbol==='XAUUSD'?'METALS':'FOREX',provider_symbol:null,
        sort_order:index,enabled:true
      }));
    const rules = (snapshot.rules as Rule[]).slice(0,50).map((rule,index)=>({
      rule_key:String(rule.ruleKey??'').slice(0,80),label:String(rule.label??'').slice(0,150),
      enabled:rule.enabled!==false,mandatory:rule.mandatory===true,
      weight:Number(rule.weight??0),minimum_confidence:Number(rule.minimumConfidence??0),
      timeframe_role:String(rule.timeframeRole??'CONFIRMATION'),sort_order:index,
      evaluation_mode:['MANUAL','EXTERNAL'].includes(String(rule.evaluationMode))?rule.evaluationMode:'AUTOMATIC',
      configuration:rule.configuration??{}
    }));
    if (instruments.length !== snapshot.instruments.length || new Set(instruments.map(item=>item.symbol)).size !== instruments.length
      || rules.length !== snapshot.rules.length || new Set(rules.map(rule=>rule.rule_key)).size !== rules.length) {
      return NextResponse.json({error:'Invalid or duplicate strategy instruments/rules.'},{status:422});
    }
    if (rules.some(rule=>!rule.rule_key || !Number.isFinite(rule.weight)
      || rule.weight<0 || rule.weight>100 || !Number.isInteger(rule.minimum_confidence)
      || rule.minimum_confidence<0 || rule.minimum_confidence>100)) {
      return NextResponse.json({error:'Invalid strategy rules.'},{status:422});
    }
    // Authenticated, invoker-rights RPC creates a private copy for the current user.
    // The shared strategy remains untouched and is never activated automatically.
    const {data:result,error:saveError} = await supabase.rpc('save_strategy_bundle',{
      p_strategy_id:null,p_profile:profile,p_instruments:instruments,
      p_sessions:[],p_rules:rules,p_stop_limits:[],p_activate:false
    });
    if (saveError || !result?.strategyId || result.saved!==true) {
      console.error('[community-install]',saveError?.code);
      return NextResponse.json({error:'Could not install this strategy.'},{status:500});
    }
    // Preserve human-evaluation settings and configuration; no automated
    // decisions should be inferred from a rule without a supported evaluator.
    const updates = await Promise.all(rules.map(rule=>supabase.from('strategy_rules')
      .update({evaluation_mode:rule.evaluation_mode,configuration:rule.configuration})
      .eq('strategy_id',result.strategyId).eq('user_id',user.id).eq('rule_key',rule.rule_key)));
    if (updates.some(update=>update.error)) {
      console.error('[community-install] Rule metadata update failed.');
      // Do not leave a partially configured strategy in the user's account.
      const {error:rollbackError} = await supabase.from('strategy_profiles').delete()
        .eq('id',result.strategyId).eq('user_id',user.id);
      if (rollbackError) console.error('[community-install] Rollback failed.',rollbackError.code);
      return NextResponse.json({error:rollbackError
        ? 'Installation incomplete. Review your strategies before retrying.'
        : 'Installation could not be completed. No strategy was activated.'},{status:500});
    }
    const {data:storedRules,error:verifyError} = await supabase.from('strategy_rules')
      .select('rule_key,evaluation_mode,configuration')
      .eq('strategy_id',result.strategyId).eq('user_id',user.id);
    const expected = new Map(rules.map(rule=>[rule.rule_key,rule]));
    const verified = !verifyError && storedRules?.length===rules.length &&
      storedRules.every(rule=>{
        const original=expected.get(rule.rule_key);
        return original && original.evaluation_mode===rule.evaluation_mode &&
          canonical(original.configuration)===canonical(rule.configuration);
      });
    if (!verified) {
      const {error:rollbackError} = await supabase.from('strategy_profiles').delete()
        .eq('id',result.strategyId).eq('user_id',user.id);
      if (rollbackError) console.error('[community-install] Verification rollback failed.',rollbackError.code);
      return NextResponse.json({error:rollbackError
        ? 'Installation incomplete. Review your strategies before retrying.'
        : 'Installation verification failed. No strategy was activated.'},{status:500});
    }
    return NextResponse.json({installed:true,strategyId:result.strategyId,activated:false},
      {headers:{'Cache-Control':'no-store'}});
  } catch {
    return NextResponse.json({error:'Could not install this strategy.'},{status:500});
  }
}
