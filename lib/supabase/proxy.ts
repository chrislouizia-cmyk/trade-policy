import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

function redirectWithNext(request: NextRequest, pathname: string) {
  const url = request.nextUrl.clone();
  const requestedPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  url.pathname = pathname;
  url.search = '';
  url.searchParams.set('next', requestedPath);
  return NextResponse.redirect(url);
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();
  const pathname = request.nextUrl.pathname;

  const publicPaths = new Set([
    '/access',
    '/client/login',
    '/hq/login',
    '/forgot-password',
    '/reset-password',
  ]);
  const isPublic = publicPaths.has(pathname) || pathname.startsWith('/auth/');

  if (!user && !isPublic) {
    return redirectWithNext(request, pathname.startsWith('/hq') || pathname.startsWith('/admin') || pathname.startsWith('/staff') ? '/hq/login' : '/client/login');
  }

  if (user && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/client/login';
    return NextResponse.redirect(url);
  }

  return response;
}
