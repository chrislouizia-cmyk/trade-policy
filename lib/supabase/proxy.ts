export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const host = request.headers.get('host');

  const routingDecision = getHostnameRoutingDecision(host, pathname);
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
    publicPaths.has(pathname) || pathname.startsWith('/auth/');

  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    console.error('[auth-debug] Missing Supabase environment variables');

    return unavailable(request, isPublic);
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),

      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );

        response = NextResponse.next({ request });

        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  let user = null;

  try {
    const { data, error } = await supabase.auth.getUser();

    if (error) {
      console.warn(
        '[auth-debug] Session could not be verified:',
        error.message
      );

      // Treat invalid sessions as logged out.
      user = null;
    } else {
      user = data.user;
    }
  } catch (error) {
    console.error('[auth-debug] getUser threw:', error);

    // Treat unexpected errors as logged out.
    user = null;
  }

  if (!user && !isPublic) {
    return redirectWithNext(
      request,
      pathname.startsWith('/hq') ||
        pathname.startsWith('/admin') ||
        pathname.startsWith('/staff')
        ? '/hq/login'
        : '/client/login'
    );
  }

  if (user && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/client/login';
    return NextResponse.redirect(url);
  }

  if (routingDecision.redirectToPortal && isPortal) {
    const url = request.nextUrl.clone();
    url.protocol = 'https:';
    url.host = 'portal.tradepolice.app';

    return NextResponse.redirect(url);
  }

  if (!isPortal && routingDecision.isPortalPath) {
    const url = request.nextUrl.clone();
    url.protocol = 'https:';
    url.host = 'portal.tradepolice.app';

    return NextResponse.redirect(url);
  }

  return response;
}