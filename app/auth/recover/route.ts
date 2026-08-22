import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSupabaseAuthCookieNames } from '@/lib/supabase/auth-cookies';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const cookieStore = await cookies();
  const authCookieNames = getSupabaseAuthCookieNames(
    cookieStore.getAll(),
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL,
  );

  const target = new URL('/client/login?next=/dashboard', url.origin);

  if (!authCookieNames.length) {
    return NextResponse.redirect(target);
  }

  const response = NextResponse.redirect(target);

  for (const name of authCookieNames) {
    response.cookies.set(name, '', {
      path: '/',
      maxAge: 0,
      expires: new Date(0),
      sameSite: 'lax',
      secure: true,
      httpOnly: true,
    });
  }

  return response;
}
