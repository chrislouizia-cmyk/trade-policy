import {NextResponse} from 'next/server';
import ExcelJS from 'exceljs';
import {createClient} from '@/lib/supabase/server';

export const runtime='nodejs';export const maxDuration=60;
const sorts=new Set(['name','plan','last_activity','account_count','analysis_count','status']);
export async function GET(request:Request){
  const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();if(!user)return NextResponse.json({error:'Authentication required.'},{status:401});
  const {data:allowed}=await supabase.rpc('has_staff_permission',{p_permission:'customers.view_metadata'});if(!allowed)return NextResponse.json({error:'Customer metadata permission required.'},{status:403});
  const url=new URL(request.url),q=(url.searchParams.get('q')||'').slice(0,120),sort=sorts.has(url.searchParams.get('sort')||'')?url.searchParams.get('sort')!:'last_activity',direction=url.searchParams.get('direction')==='asc'?'asc':'desc';
  const rows:any[]=[];let page=1,total=0;const batchSize=1000,maxRows=50_000;
  do{const {data,error}=await supabase.rpc('staff_customer_directory_v2',{p_query:q,p_page:page,p_page_size:batchSize,p_sort:sort,p_direction:direction});if(error)return NextResponse.json({error:'Customer export query failed.'},{status:500});rows.push(...(data?.rows??[]));total=Number(data?.total??0);page+=1}while(rows.length<total&&rows.length<maxRows);
  if(total>maxRows)return NextResponse.json({error:`Export exceeds the ${maxRows.toLocaleString()} row safety limit. Narrow the search and try again.`},{status:413});
  const workbook=new ExcelJS.Workbook();workbook.creator='Trade Police HQ';workbook.created=new Date();const sheet=workbook.addWorksheet('Customers',{views:[{state:'frozen',ySplit:1}]});
  sheet.columns=[{header:'Customer ID',key:'customer_id',width:38},{header:'Name',key:'display_name',width:24},{header:'Email',key:'email',width:32},{header:'Plan',key:'plan',width:14},{header:'Status',key:'subscription_status',width:18},{header:'Created At',key:'created_at',width:24},{header:'Last Activity',key:'last_activity_at',width:24},{header:'Active Strategy',key:'active_strategy',width:24},{header:'Trading Accounts',key:'account_count',width:18},{header:'Analyses',key:'analysis_count',width:12},{header:'Open Trades',key:'open_trades',width:14},{header:'Closed Trades',key:'closed_trades',width:14}];
  sheet.addRows(rows);sheet.getRow(1).font={bold:true};sheet.autoFilter={from:'A1',to:'L1'};
  const buffer=await workbook.xlsx.writeBuffer();const date=new Date().toISOString().slice(0,10);
  return new NextResponse(buffer as BodyInit,{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="trade-police-customers-${date}.xlsx"`,'Cache-Control':'private, no-store'}});
}
