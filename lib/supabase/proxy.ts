import { createServerClient } from '@supabase/ssr';
import {
  NextResponse,
  type NextRequest,
} from 'next/server';

import {
  getHostnameRoutingDecision,
  isPortalHostname,
} from '@/lib/hostname-routing';

function redirectWithNext(
  request: NextRequest,
  destination: string,
) {
  const url = request.nextUrl.clone();

  url.pathname = destination;
  url.search = '';

  const requestedPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;

  if (
    requestedPath &&
    requestedPath !== destination &&
    requestedPath !== '/'
  ) {
    url.searchParams.set('next', requestedPath);
  }

  return NextResponse.redirect(url);
}

function unavailable(
  request: NextRequest,
  isPublic: boolean,
) {
  if (isPublic) {
    return NextResponse.next({
      request,
    });
  }

  return NextResponse.json(
    {
      error: 'SERVICE_UNAVAILABLE',
      message:
        'Authentication is temporarily unavailable. Please try again shortly.',
    },
    {
      status: 503,
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}

export async function updateSession(
  request: NextRequest,
) {
  const pathname = request.nextUrl.pathname;
  const host = request.headers.get('host');

  const routingDecision =
    getHostnameRoutingDecision(host, pathname);

  const isPortal = isPortalHostname(host);

  const publicPaths = new Set([
    '/',
    '/access',
    '/pricing',
    '/legal',
    '/client/login',
    '/hq/login',
    '/forgot-password',
    '/reset-password',
  ]);

  const isPublic =
    publicPaths.has(pathname) ||
    pathname.startsWith('/auth/');

  let response = NextResponse.next({
    request,
  });

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL;

  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error(
      '[auth-debug] Missing Supabase environment variables',
    );

    return unavailable(request, isPublic);
  }

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },

        setAll(cookiesToSet) {
          cookiesToSet.forEach(
            ({ name, value }) => {
              request.cookies.set(name, value);
            },
          );

          response = NextResponse.next({
            request,
          });

          cookiesToSet.forEach(
            ({
              name,
              value,
              options,
            }) => {
              response.cookies.set(
                name,
                value,
                options,
              );
            },
          );
        },
      },
    },
  );

  let user = null;

  try {
    const {
      data,
      error,
    } = await supabase.auth.getUser();

    if (error) {
      console.warn(
        '[auth-debug] Session could not be verified:',
        error.message,
      );

      user = null;
    } else {
      user = data.user;
    }
  } catch (error) {
    console.error(
      '[auth-debug] getUser threw:',
      error,
    );

    user = null;
  }

  if (!user && !isPublic) {
    const isStaffPath =
      pathname.startsWith('/hq') ||
      pathname.startsWith('/admin') ||
      pathname.startsWith('/staff');

    return redirectWithNext(
      request,
      isStaffPath
        ? '/hq/login'
        : '/client/login',
    );
  }

  if (user && pathname === '/login') {
    const url = request.nextUrl.clone();

    url.pathname = '/client/login';
    url.search = '';

    return NextResponse.redirect(url);
  }

  if (
    routingDecision.redirectToPortal &&
    isPortal
  ) {
    const url = request.nextUrl.clone();

    url.protocol = 'https:';
    url.host = 'portal.tradepolice.app';

    return NextResponse.redirect(url);
  }

  if (
    !isPortal &&
    routingDecision.isPortalPath
  ) {
    const url = request.nextUrl.clone();

    url.protocol = 'https:';
    url.host = 'portal.tradepolice.app';

    return NextResponse.redirect(url);
  }

  return response;
}