import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { loadActiveStrategy } from '@/lib/server/active-strategy';
import { apiError } from '@/lib/server/public-error';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return apiError('UNAUTHORIZED','Unauthorized.',401);
    }

    const strategy = await loadActiveStrategy(supabase, user.id);
    return NextResponse.json(
      { strategy },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  } catch (error) {
    console.error('Active strategy error:', error);
    return apiError('ACTIVE_STRATEGY_UNAVAILABLE',error instanceof Error?error.message:'Could not load the active strategy.',500);
  }
}
