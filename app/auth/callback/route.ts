import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

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
    return NextResponse.redirect(target);
  }

  if (errorMessage) {
    const target = new URL('/reset-password', url.origin);
    target.searchParams.set('error', errorMessage);
    return NextResponse.redirect(target);
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
