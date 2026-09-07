import 'server-only';

type AdminClient=ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>;

export async function buildMarketplaceEvidence(admin:AdminClient,strategyId:string,strategyRevisionId:string){
  const [tradesResult,decisionsResult,runsResult]=await Promise.all([
    admin.from('active_trades').select('id,instrument,outcome,result_r,closed_at,taken_against_verdict,activation_mode')
      .eq('strategy_profile_id',strategyId).eq('strategy_revision_id',strategyRevisionId).eq('status','CLOSED')
      .not('closed_at','is',null).not('result_r','is',null).order('closed_at',{ascending:true}).limit(500),
    admin.from('decision_reports').select('id',{count:'exact',head:true})
      .eq('strategy_id',strategyId).eq('strategy_revision_id',strategyRevisionId),
    admin.from('backtest_runs').select('id,instrument,execution_timeframe,period_start,period_end,completed_at')
      .eq('strategy_profile_id',strategyId).eq('strategy_revision_id',strategyRevisionId).eq('status','COMPLETED')
      .order('completed_at',{ascending:false}).limit(5),
  ]);
  const queryError=tradesResult.error??decisionsResult.error??runsResult.error;
  if(queryError)throw queryError;
  const runIds=(runsResult.data??[]).map(run=>run.id);
  const resultsResult=runIds.length
    ?await admin.from('backtest_results').select('run_id,ending_balance,net_return_percent,total_trades,wins,losses,breakeven,win_rate,profit_factor,expectancy_r,average_r,max_drawdown_percent').in('run_id',runIds)
    :{data:[],error:null};
  if(resultsResult.error)throw resultsResult.error;
  const trades=(tradesResult.data??[]).map(trade=>({...trade,resultR:Number(trade.result_r)}));
  let cumulativeR=0,peakR=0,maxDrawdownR=0;
  const equityCurve=[{index:0,cumulativeR:0},...trades.map((trade,index)=>{
    cumulativeR+=trade.resultR;peakR=Math.max(peakR,cumulativeR);maxDrawdownR=Math.max(maxDrawdownR,peakR-cumulativeR);
    return {index:index+1,cumulativeR:Number(cumulativeR.toFixed(4))};
  })];
  const wins=trades.filter(trade=>trade.resultR>0).length,losses=trades.filter(trade=>trade.resultR<0).length;
  const resultsByRun=new Map((resultsResult.data??[]).map(result=>[result.run_id,result]));
  return {
    scope:'EXACT_STRATEGY_REVISION' as const,
    firstEvidenceAt:trades[0]?.closed_at??null,
    decisionCount:decisionsResult.count??0,
    live:{
      tradeCount:trades.length,wins,losses,breakeven:trades.length-wins-losses,
      winRate:trades.length?Number((wins/trades.length*100).toFixed(2)):null,
      totalR:Number(cumulativeR.toFixed(4)),averageR:trades.length?Number((cumulativeR/trades.length).toFixed(4)):null,
      maxDrawdownR:Number(maxDrawdownR.toFixed(4)),
      adherencePercent:trades.length?Number((trades.filter(trade=>trade.taken_against_verdict!==true).length/trades.length*100).toFixed(2)):null,
      equityCurve,
      recentTrades:trades.slice(-20).reverse().map(trade=>({id:trade.id,instrument:trade.instrument,outcome:trade.outcome,resultR:trade.resultR,closedAt:trade.closed_at,activationMode:trade.activation_mode,followedVerdict:trade.taken_against_verdict!==true})),
    },
    backtests:(runsResult.data??[]).map(run=>({...run,result:resultsByRun.get(run.id)??null})),
  };
}
