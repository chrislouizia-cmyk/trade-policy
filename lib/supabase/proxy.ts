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
  const pathname = request.nextUrl.pathname;
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
  const isPublic = publicPaths.has(pathname) || pathname.startsWith('/auth/');
  let response = NextResponse.next({ request });
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if(!url||!anonKey)return unavailable(request,isPublic);
  const supabase = createServerClient(
    url,
    anonKey,
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

  let user;
  try{
    const result=await supabase.auth.getUser();
    if(result.error&&!result.data.user)return unavailable(request,isPublic);
    user=result.data.user;
  }catch{return unavailable(request,isPublic)}

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

function unavailable(request:NextRequest,isPublic:boolean){
  if(isPublic)return NextResponse.next({request});
  if(request.nextUrl.pathname.startsWith('/api/'))return NextResponse.json({error:{code:'AUTH_SERVICE_UNAVAILABLE',message:'Authentication is temporarily unavailable. Please try again shortly.'}},{status:503,headers:{'Cache-Control':'no-store','Retry-After':'30'}});
  return new NextResponse('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Trade Police temporarily unavailable</title></head><body style="margin:0;background:#07111f;color:#f4f7fb;font:16px system-ui;display:grid;min-height:100vh;place-items:center"><main style="max-width:34rem;padding:2rem"><h1>Trade Police is temporarily unavailable</h1><p>We could not verify your session. No trade or billing data was changed.</p><p>Please check your connection and try again shortly.</p><button onclick="location.reload()" style="padding:.75rem 1rem">Try again</button></main></body></html>',{status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Retry-After':'30'}})
}
