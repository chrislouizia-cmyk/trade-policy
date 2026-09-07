import { NextResponse } from 'next/server';
import { publicApiError } from '@/lib/server/public-error';
import { createClient } from '@/lib/supabase/server';
import { fetchPrice } from '@/lib/market-data';
import {reserveTwelveDataCredits,ProviderCreditLimitError} from '@/lib/server/provider-credit-coordinator';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error:'Unauthorized' }, { status:401 });
    const { tradeId } = await request.json();
    const { data: trade, error } = await supabase.from('active_trades').select('*').eq('id',tradeId).eq('user_id',user.id).single();
    if (error || !trade) return NextResponse.json({ error:'Active trade not found.' }, { status:404 });
    await reserveTwelveDataCredits({requestKey:`trade-price:${user.id}:${trade.id}:${request.headers.get('idempotency-key')??Date.now()}`,operation:'active-trade.price',priority:'LIVE',credits:1});
    const price = await fetchPrice(trade.instrument);
    const riskDistance = Math.abs(Number(trade.entry)-Number(trade.stop_loss));
    const signedMove = trade.direction === 'BUY' ? price-Number(trade.entry) : Number(trade.entry)-price;
    const currentR = riskDistance > 0 ? signedMove/riskDistance : 0;
    const mfeR = Math.max(Number(trade.mfe_r || 0), currentR);
    const maeR = Math.min(Number(trade.mae_r || 0), currentR);
    const { data: updated, error: updateError } = await supabase.from('active_trades').update({ current_price:price, current_r:currentR, mfe_r:mfeR, mae_r:maeR, last_price_at:new Date().toISOString(), updated_at:new Date().toISOString() }).eq('id',trade.id).eq('user_id',user.id).select().single();
    if (updateError) throw updateError;
    return NextResponse.json({ trade:updated });
  } catch (error) { if(error instanceof ProviderCreditLimitError)return NextResponse.json({error:error.message,code:'MARKET_DATA_CREDIT_WINDOW',retryAfterSeconds:error.reservation.retryAfterSeconds},{status:429});return NextResponse.json({ error:error instanceof Error?error.message:'Could not refresh price.' }, { status:500 }); }
}
