import { NextResponse } from 'next/server';
import { publicApiError } from '@/lib/server/public-error';
import { createClient } from '@/lib/supabase/server';
import { canCloseTrade } from '@/lib/server/trade-lifecycle';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { tradeId, closePrice, fees = 0, notes = null, outcome = 'BREAKEVEN' } = await request.json();
    const numericPrice = Number(closePrice);
    const numericFees = Number(fees ?? 0);
    if (!tradeId || !Number.isFinite(numericPrice) || numericPrice <= 0 || !Number.isFinite(numericFees) || numericFees < 0) {
      return NextResponse.json({ error: 'Invalid close information.' }, { status: 400 });
    }

    const { data: existingTrade, error: tradeLookupError } = await supabase.from('active_trades').select('id,status').eq('id', tradeId).eq('user_id', user.id).maybeSingle();
    if (tradeLookupError) throw tradeLookupError;
    if (!existingTrade) {
      return NextResponse.json({ error: 'The trade could not be found.' }, { status: 404 });
    }

    const lifecycleCheck = canCloseTrade({ currentStatus: existingTrade.status, outcome, exitPrice: numericPrice, closedAt: new Date().toISOString() });
    if (!lifecycleCheck.allowed) {
      return NextResponse.json({ error: 'This trade is already closed.' }, { status: 409 });
    }

    const { data, error } = await supabase.rpc('close_active_trade_with_ledger', {
      p_trade_id: tradeId,
      p_close_price: numericPrice,
      p_fees: numericFees,
      p_notes: notes,
    });
    if (error) throw error;

    const { data: canonicalTrade, error: verificationError } = await supabase
      .from('active_trades')
      .select('id,trade_record_id,status,closed_at,result_r,outcome')
      .eq('id', tradeId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (verificationError) throw verificationError;
    if (!canonicalTrade || canonicalTrade.status !== 'CLOSED' || !canonicalTrade.closed_at) {
      throw new Error('Trade closure did not reach canonical CLOSED state.');
    }

    console.info('[TRADE_CLOSE_CANONICAL_CONFIRMED]', {
      tradeId: canonicalTrade.id,
      tradeRecordId: canonicalTrade.trade_record_id,
      status: canonicalTrade.status,
      closedAt: canonicalTrade.closed_at,
      resultR: canonicalTrade.result_r,
      outcome: canonicalTrade.outcome,
    });

    return NextResponse.json(
      { result: data, lifecycle: lifecycleCheck, canonicalTrade },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return publicApiError({message:'We could not close this trade. No balance change was applied.',code:'TRADE_CLOSE_FAILED',internalCode:'TRADE_CLOSE_FAILED',endpoint:'/app/api/trades/close',error});
  }
}
