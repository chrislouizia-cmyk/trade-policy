import { NextResponse } from 'next/server';

import { apiError } from '@/lib/server/public-error';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return apiError('UNAUTHORIZED', 'Unauthorized.', 401);

    const { data, error } = await supabase.rpc('private_beta_get_status');
    if (error) return apiError('PRIVATE_BETA_STATUS_FAILED', error.message, 500);

    return NextResponse.json(data ?? {}, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiError('PRIVATE_BETA_STATUS_FAILED', error instanceof Error ? error.message : 'Private Beta status could not be loaded.', 500);
  }
}

export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return apiError('UNAUTHORIZED', 'Unauthorized.', 401);

    const { data, error } = await supabase.rpc('private_beta_apply');
    if (error) return apiError('PRIVATE_BETA_APPLICATION_FAILED', error.message, 400);

    return NextResponse.json(data ?? {}, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiError('PRIVATE_BETA_APPLICATION_FAILED', error instanceof Error ? error.message : 'Private Beta application failed.', 500);
  }
}
