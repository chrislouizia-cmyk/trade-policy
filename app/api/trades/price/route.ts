import { NextResponse } from 'next/server';
import { publicApiError } from '@/lib/server/public-error';
import { createClient } from '@/lib/supabase/server';
import { fetchPrice } from '@/lib/market-data';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error:'Unauthorized' }, { status:401 });
    const { tradeId } = await request.json();
    const { data: trade, error } = await supabase.from('active_trades').select('*').eq('id',tradeId).eq('user_id',user.id).single();
    if (error || !trade) return NextResponse.json({ error:'Active trade not found.' }, { status:404 });
    const price = await fetchPrice(trade.instrument);
    const riskDistance = Math.abs(Number(trade.entry)-Number(trade.stop_loss));
    const signedMove = trade.direction === 'BUY' ? price-Number(trade.entry) : Number(trade.entry)-price;
    const currentR = riskDistance > 0 ? signedMove/riskDistance : 0;
    const mfeR = Math.max(Number(trade.mfe_r || 0), currentR);
    const maeR = Math.min(Number(trade.mae_r || 0), currentR);
    const { data: updated, error: updateError } = await supabase.from('active_trades').update({ current_price:price, current_r:currentR, mfe_r:mfeR, mae_r:maeR, last_price_at:new Date().toISOString(), updated_at:new Date().toISOString() }).eq('id',trade.id).eq('user_id',user.id).select().single();
    if (updateError) throw updateError;
    return NextResponse.json({ trade:updated });
  } catch (error) { return NextResponse.json({ error:error instanceof Error?error.message:'Could not refresh price.' }, { status:500 }); }
}
