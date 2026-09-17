import ExcelJS from 'exceljs';
import {NextResponse} from 'next/server';

import {apiError} from '@/lib/server/public-error';
import {createClient} from '@/lib/supabase/server';

export const runtime='nodejs';
export const dynamic='force-dynamic';

function safeFilePart(value:string){return value.replace(/[^a-z0-9_-]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,60)||'backtest';}

export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
  const supabase=await createClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user)return apiError('UNAUTHORIZED','Unauthorized.',401);

  const {id}=await params;
  const {data:run,error:runError}=await supabase.from('backtest_runs').select('*').eq('id',id).eq('user_id',user.id).maybeSingle();
  if(runError)return apiError('BACKTEST_EXPORT_FAILED','Backtest report could not be loaded.',500);
  if(!run)return apiError('BACKTEST_NOT_FOUND','Backtest run not found.',404);
  if(run.status!=='COMPLETED')return apiError('BACKTEST_NOT_COMPLETED','Only completed backtests can be exported.',409);

  const [{data:result,error:resultError},{data:trades,error:tradesError}]=await Promise.all([
    supabase.from('backtest_results').select('*').eq('run_id',id).maybeSingle(),
    supabase.from('backtest_trades').select('*').eq('run_id',id).order('sequence',{ascending:true}),
  ]);
  if(resultError||tradesError||!result)return apiError('BACKTEST_EXPORT_FAILED','Persisted backtest results could not be loaded.',500);

  const workbook=new ExcelJS.Workbook();
  workbook.creator='Trade Police';
  workbook.created=new Date();
  const summary=workbook.addWorksheet('Summary',{views:[{state:'frozen',ySplit:1}]});
  summary.columns=[{header:'Metric',key:'metric',width:32},{header:'Value',key:'value',width:28}];
  const totalTrades=Number(result.total_trades??trades?.length??0);
  const outcome=totalTrades===0?'Completed — no setup matched every strategy rule':'Completed — simulated trades produced';
  summary.addRows([
    {metric:'Run status',value:run.status},{metric:'Outcome',value:outcome},{metric:'Strategy',value:run.strategy_snapshot_json?.name??run.strategy_profile_id},
    {metric:'Revision',value:run.strategy_revision_id},{metric:'Instrument',value:run.instrument},{metric:'Period start',value:run.period_start},
    {metric:'Period end',value:run.period_end},{metric:'Starting balance',value:Number(run.starting_balance)},{metric:'Ending balance',value:result.ending_balance==null?'':Number(result.ending_balance)},
    {metric:'Total trades',value:totalTrades},{metric:'Net return %',value:totalTrades?Number(result.net_return_percent??0):'N/A — no trades'},
    {metric:'Win rate %',value:totalTrades?Number(result.win_rate??0):'N/A — no trades'},{metric:'Profit factor',value:totalTrades?result.profit_factor??'N/A':'N/A — no trades'},
    {metric:'Expectancy R',value:totalTrades?result.expectancy_r??'N/A':'N/A — no trades'},{metric:'Max drawdown %',value:totalTrades?result.max_drawdown_percent??0:'N/A — no trades'},
  ]);
  summary.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};summary.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF142338'}};

  const tradeSheet=workbook.addWorksheet('Trades',{views:[{state:'frozen',ySplit:1}]});
  tradeSheet.columns=[
    {header:'#',key:'sequence',width:8},{header:'Direction',key:'direction',width:12},{header:'Entry time',key:'entry_timestamp',width:24},
    {header:'Exit time',key:'exit_timestamp',width:24},{header:'Entry',key:'entry',width:15},{header:'Exit',key:'exit_price',width:15},
    {header:'Net P&L',key:'net_pnl',width:15},{header:'Net R',key:'net_r',width:12},{header:'Setup',key:'setup_type',width:24},{header:'Exit reason',key:'exit_reason',width:28},
  ];
  tradeSheet.addRows((trades??[]).map(trade=>({...trade,entry:Number(trade.entry),exit_price:trade.exit_price==null?'':Number(trade.exit_price),net_pnl:trade.net_pnl==null?'':Number(trade.net_pnl),net_r:trade.net_r==null?'':Number(trade.net_r)})));
  tradeSheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};tradeSheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF142338'}};
  if(totalTrades===0)tradeSheet.addRow({direction:'No trades',exit_reason:'The run completed successfully; no setup matched every strategy rule.'});

  const buffer=await workbook.xlsx.writeBuffer();
  const filename=`${safeFilePart(String(run.strategy_snapshot_json?.name??run.instrument))}-${safeFilePart(String(run.period_start).slice(0,10))}-backtest.xlsx`;
  return new NextResponse(Buffer.from(buffer),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="${filename}"`,'Cache-Control':'private, no-store'}});
}
