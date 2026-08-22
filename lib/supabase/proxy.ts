import { createServerClient } from '@supabase/ssr';
import {
  NextResponse,
  type NextRequest,
} from 'next/server';

import {
  getHQEntryDestination,
  getHostnameRoutingDecision,
  isHQEntryPath,
} from '@/lib/hostname-routing';
import { getCanonicalAppUrls } from '@/lib/app-urls';
import { getSafeClientNextPath } from '@/lib/auth/safe-next';

function redirectToOrigin(request: NextRequest, origin: string) {
  const destination = new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, origin);
  return NextResponse.redirect(destination);
}

function redirectToLogin(request: NextRequest, origin: string, pathname: string) {
  const destination = new URL(pathname, origin);
  const requestedPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  const safeNext = getSafeClientNextPath(requestedPath, pathname, '/dashboard');
  if (safeNext !== '/dashboard' && safeNext !== pathname) destination.searchParams.set('next', safeNext);
  return NextResponse.redirect(destination);
}

function isMissingSession(error: { name?: string; code?: string }) {
  return error.name === 'AuthSessionMissingError' || error.code === 'session_not_found';
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
  const canonicalUrls = getCanonicalAppUrls();

  const publicPaths = new Set([
    '/',
    '/access',
    '/about',
    '/faq',
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
      '[auth] Missing Supabase environment variables',
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
      if (!isMissingSession(error)) {
        console.error('[auth] Session verification failed', {
          name: error.name,
          code: error.code,
          status: error.status,
        });
      }

      user = null;
    } else {
      user = data.user;
    }
  } catch (error) {
    console.error('[auth] Session verification threw', {
      name: error instanceof Error ? error.name : 'UnknownAuthError',
    });

    user = null;
  }

  if (routingDecision.mode === 'hq' && isHQEntryPath(pathname)) {
    let pendingInvitation = false;
    let workspaceRoute: string | null = null;
    if (user) {
      const [{data:invitation},{data:route}] = await Promise.all([
        supabase.rpc('current_staff_invitation_onboarding_v1'),
        supabase.rpc('staff_workspace_route'),
      ]);
      pendingInvitation = Boolean(invitation);
      workspaceRoute = typeof route === 'string' ? route : null;
    }
    const destination = getHQEntryDestination({
      pathname,
      authenticated: Boolean(user),
      pendingInvitation,
      workspaceRoute,
      accessError: request.nextUrl.searchParams.get('error') === 'access',
    });
    if (destination) return NextResponse.redirect(new URL(destination, canonicalUrls.hq));
  }

  if (!user && !isPublic) {
    const isStaffPath =
      pathname.startsWith('/hq') ||
      pathname.startsWith('/admin') ||
      pathname.startsWith('/staff') ||
      pathname.startsWith('/api/hq');

    return redirectToLogin(
      request,
      isStaffPath ? canonicalUrls.hq : canonicalUrls.portal,
      isStaffPath ? '/hq/login' : '/client/login',
    );
  }

  if (user && pathname === '/login') {
    const url = request.nextUrl.clone();

    url.pathname = '/client/login';
    url.search = '';

    return NextResponse.redirect(url);
  }

  if (routingDecision.redirectTarget === 'portal') {
    return redirectToOrigin(request, canonicalUrls.portal);
  }

  if (routingDecision.redirectTarget === 'hq') {
    return redirectToOrigin(request, canonicalUrls.hq);
  }

  if (!isPublic) {
    response.headers.set('Cache-Control', 'private, no-store, max-age=0');
    response.headers.set('Pragma', 'no-cache');
  }

  return response;
}
