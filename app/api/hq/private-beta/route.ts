import { NextResponse } from 'next/server';
import { z } from 'zod';

import { apiError } from '@/lib/server/public-error';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const reviewSchema = z.object({
  userId: z.string().uuid(),
  decision: z.enum(['APPROVE', 'REJECT']),
  note: z.string().max(1000).nullable().optional(),
});

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return apiError('UNAUTHORIZED', 'Unauthorized.', 401);

    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const { data, error } = await supabase.rpc('staff_private_beta_queue', {
      p_status: status || null,
      p_limit: 500,
    });
    if (error) return apiError('PRIVATE_BETA_QUEUE_FAILED', error.message, 403);

    return NextResponse.json({ items: data ?? [] }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiError('PRIVATE_BETA_QUEUE_FAILED', error instanceof Error ? error.message : 'Private Beta queue could not be loaded.', 500);
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return apiError('UNAUTHORIZED', 'Unauthorized.', 401);

    const parsed = reviewSchema.safeParse(await request.json());
    if (!parsed.success) return apiError('INVALID_PRIVATE_BETA_REVIEW', parsed.error.issues[0]?.message ?? 'Invalid review.', 400);

    const { data, error } = await supabase.rpc('staff_private_beta_review', {
      p_user_id: parsed.data.userId,
      p_decision: parsed.data.decision,
      p_review_note: parsed.data.note ?? null,
    });
    if (error) return apiError('PRIVATE_BETA_REVIEW_FAILED', error.message, 403);

    return NextResponse.json(data ?? {}, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiError('PRIVATE_BETA_REVIEW_FAILED', error instanceof Error ? error.message : 'Private Beta review failed.', 500);
  }
}
