import { NextResponse } from 'next/server';
import { z } from 'zod';

import { apiError } from '@/lib/server/public-error';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const codeSchema = z.string().uuid();

async function context(params: Promise<{ code: string }>) {
  const parsed = codeSchema.safeParse((await params).code);
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  return { parsed, supabase, user: error ? null : user };
}

function shareError(message: string) {
  const unavailable = /unavailable|revoked|not found/i.test(message);
  return apiError(unavailable ? 'SHARE_UNAVAILABLE' : 'SHARE_FAILED', message, unavailable ? 404 : 500);
}

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { parsed, supabase, user } = await context(params);
  if (!user) return apiError('UNAUTHORIZED', 'Sign in to view this shared strategy.', 401);
  if (!parsed.success) return apiError('INVALID_SHARE', 'This share link is invalid.', 400);

  const { data, error } = await supabase.rpc('resolve_strategy_share_v1', {
    p_share_code: parsed.data,
  });
  if (error) return shareError(error.message);
  return NextResponse.json({ share: data }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { parsed, supabase, user } = await context(params);
  if (!user) return apiError('UNAUTHORIZED', 'Sign in to install this shared strategy.', 401);
  if (!parsed.success) return apiError('INVALID_SHARE', 'This share link is invalid.', 400);

  const { data, error } = await supabase.rpc('install_strategy_share_v1', {
    p_share_code: parsed.data,
  });
  if (error) {
    const status = /allows .* active strategies/i.test(error.message) ? 403 : 500;
    return apiError(status === 403 ? 'STRATEGY_LIMIT_REACHED' : 'SHARE_INSTALL_FAILED', error.message, status);
  }
  return NextResponse.json({ install: data }, { headers: { 'Cache-Control': 'no-store' } });
}
