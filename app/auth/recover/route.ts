import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  getSupabaseAuthCookieDeletionVariants,
  getSupabaseAuthCookieNames,
} from '@/lib/supabase/auth-cookies';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const cookieStore = await cookies();
  const authCookieNames = getSupabaseAuthCookieNames(
    cookieStore.getAll(),
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL,
  );

  const target = new URL('/client/login?next=/dashboard', url.origin);
  target.searchParams.set('recovered', '1');

  console.info('[AUTH_RECOVERY_DIAGNOSTIC]', {
    pathname: '/auth/recover',
    redirectDestination: '/client/login?next=/dashboard&recovered=1',
    recovered: true,
    authStateCategory: authCookieNames.length > 0 ? 'stale' : 'missing',
    hasMatchingSupabaseAuthCookies: authCookieNames.length > 0,
  });

  if (!authCookieNames.length) {
    return NextResponse.redirect(target);
  }

  const response = NextResponse.redirect(target);
  const deletionVariants: string[] = [];

  for (const name of authCookieNames) {
    const variants = getSupabaseAuthCookieDeletionVariants(name, url.hostname);
    deletionVariants.push(...variants);
    for (const variant of variants) {
      response.headers.append('Set-Cookie', variant);
    }
  }

  console.info('[AUTH_RECOVERY_DELETIONS]', {
    cookieNames: authCookieNames,
    deletionVariants: deletionVariants.map((variant) => variant.split(';')[0].trim()),
  });

  return response;
}
