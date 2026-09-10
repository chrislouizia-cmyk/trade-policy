import { NextResponse } from 'next/server';
import { z } from 'zod';

import { apiError } from '@/lib/server/public-error';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const reviewSchema = z.object({
  affiliateId: z.string().uuid(),
  decision: z.enum(['APPROVE', 'REJECT', 'SUSPEND', 'REACTIVATE']),
  reason: z.string().trim().max(1000).nullable().optional(),
});

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return apiError('UNAUTHORIZED', 'Unauthorized.', 401);

    const url = new URL(request.url);
    const status = url.searchParams.get('status');

    const { data, error } = await supabase.rpc('staff_affiliate_queue', {
      p_status: status || null,
    });

    if (error) {
      return apiError('AFFILIATE_QUEUE_FAILED', error.message, 403);
    }

    return NextResponse.json(
      { items: data ?? [] },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return apiError(
      'AFFILIATE_QUEUE_FAILED',
      error instanceof Error
        ? error.message
        : 'Affiliate queue could not be loaded.',
      500
    );
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return apiError('UNAUTHORIZED', 'Unauthorized.', 401);

    const parsed = reviewSchema.safeParse(await request.json());

    if (!parsed.success) {
      return apiError(
        'INVALID_AFFILIATE_REVIEW',
        parsed.error.issues[0]?.message ?? 'Invalid affiliate review.',
        400
      );
    }

    const { data, error } = await supabase.rpc('staff_review_affiliate', {
      p_affiliate_id: parsed.data.affiliateId,
      p_decision: parsed.data.decision,
      p_reason: parsed.data.reason ?? null,
    });

    if (error) {
      return apiError('AFFILIATE_REVIEW_FAILED', error.message, 403);
    }

    return NextResponse.json(data ?? {}, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiError(
      'AFFILIATE_REVIEW_FAILED',
      error instanceof Error ? error.message : 'Affiliate review failed.',
      500
    );
  }
}
