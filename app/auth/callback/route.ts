import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { recordServerBetaEvent } from '@/lib/server/beta-events';
import { getCanonicalAppUrls } from '@/lib/app-urls';

function safeNext(value: string | null) {
  return value && value.startsWith('/') && !value.startsWith('//')
    ? value
    : '/validate';
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');
  const next = safeNext(url.searchParams.get('next'));
  const portal = url.searchParams.get('portal') ?? new URLSearchParams(next.split('?')[1] ?? '').get('portal');
  const supabase = await createClient();

  let errorMessage: string | null = null;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    errorMessage = error?.message ?? null;
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as 'recovery' | 'signup' | 'invite' | 'magiclink' | 'email_change' | 'email',
    });
    errorMessage = error?.message ?? null;
  } else {
    const target = new URL('/reset-password', url.origin);
    target.searchParams.set('error', 'invalid-link');
    if (portal) target.searchParams.set('portal', portal);
    return NextResponse.redirect(target);
  }

  if (errorMessage) {
    const target = new URL('/reset-password', url.origin);
    target.searchParams.set('error', errorMessage);
    if (portal) target.searchParams.set('portal', portal);
    return NextResponse.redirect(target);
  }

  const {data:{user}}=await supabase.auth.getUser();
  const recentlyCreated=user?.created_at&&Date.now()-new Date(user.created_at).getTime()<10*60_000;
  if(user&&(type==='signup'||(next==='/onboarding'&&recentlyCreated)))await recordServerBetaEvent(user.id,'SIGNUP_COMPLETED');
  const urls = getCanonicalAppUrls();
  const isProductionDomain = url.hostname === 'tradepolice.app' || url.hostname.endsWith('.tradepolice.app');
  const isHQRecovery = portal === 'hq' || next.includes('portal=hq') || next.startsWith('/hq');
  const destinationOrigin = isProductionDomain ? (isHQRecovery ? urls.hq : urls.portal) : url.origin;
  return NextResponse.redirect(new URL(next, destinationOrigin));
}
