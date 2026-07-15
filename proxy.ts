import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';

export async function proxy(request: NextRequest) {
  const host = request.headers.get('host')?.split(':')[0].toLowerCase() ?? '';
  const pathname = request.nextUrl.pathname;
  const isAdminHost = host === 'admin.tradepolice.com' || host.startsWith('admin.');
  const isClientHost = host === 'app.tradepolice.com' || host.startsWith('app.');

  if (isAdminHost && !pathname.startsWith('/hq')) {
    const url = request.nextUrl.clone();
    url.pathname = pathname === '/' ? '/hq' : pathname === '/login' ? '/hq/login' : `/hq${pathname}`;
    return NextResponse.redirect(url);
  }

  if (isClientHost && (pathname.startsWith('/hq') || pathname.startsWith('/admin') || pathname.startsWith('/staff'))) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  return updateSession(request);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
