import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { publicApiError } from '@/lib/server/public-error';
import { isTradeLifecycleV2Enabled } from '@/lib/server/trade-lifecycle-v2';

const requestSchema = z.object({
  closePrice: z.coerce.number(),
  fees: z.coerce.number().optional().default(0),
  notes: z.string().nullable().optional(),
  outcome: z.string().nullable().optional(),
}).passthrough();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (!isTradeLifecycleV2Enabled()) {
      return NextResponse.json(
        { error: 'Trade lifecycle V2 is disabled for this environment.', code: 'TRADE_LIFECYCLE_V2_DISABLED' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }

    const { id } = await context.params;
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({
        error: 'Invalid close payload.',
        code: 'INVALID_CLOSE_PAYLOAD',
        details: parsed.error.flatten(),
      }, { status: 400 });
    }

    const admin = createAdminClient();
    const response = await admin.rpc('close_trade_v2', {
      p_user_id: user.id,
      p_trade_id: id,
      p_close_price: Number(parsed.data.closePrice),
      p_fees: Number(parsed.data.fees ?? 0),
      p_notes: parsed.data.notes ?? null,
      p_outcome: parsed.data.outcome ?? null,
    });

    if (response.error) {
      return NextResponse.json({
        error: response.error.message || 'The trade could not be closed.',
        code: response.error.code || 'TRADE_CLOSE_FAILED',
      }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
    }

    return NextResponse.json({
      result: response.data,
      route: 'close_trade_v2',
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return publicApiError({
      message: 'We could not close this trade. No balance change was applied.',
      code: 'TRADE_CLOSE_FAILED',
      internalCode: 'TRADE_CLOSE_FAILED',
      endpoint: '/api/trades/[id]/close',
      error,
    });
  }
}
