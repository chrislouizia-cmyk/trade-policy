import { NextResponse } from 'next/server';
import { publicApiError } from '@/lib/server/public-error';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { tradeId, closePrice, fees = 0, notes = null } = await request.json();
    const numericPrice = Number(closePrice);
    const numericFees = Number(fees ?? 0);
    if (!tradeId || !Number.isFinite(numericPrice) || numericPrice <= 0 || !Number.isFinite(numericFees) || numericFees < 0) {
      return NextResponse.json({ error: 'Invalid close information.' }, { status: 400 });
    }

    const { data, error } = await supabase.rpc('close_active_trade_with_ledger', {
      p_trade_id: tradeId,
      p_close_price: numericPrice,
      p_fees: numericFees,
      p_notes: notes,
    });
    if (error) throw error;
    return NextResponse.json({ result: data });
  } catch (error) {
    return publicApiError({message:'We could not close this trade. No balance change was applied.',code:'TRADE_CLOSE_FAILED',internalCode:'TRADE_CLOSE_FAILED',endpoint:'/app/api/trades/close',error});
  }
}
