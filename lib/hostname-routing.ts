const PORTAL_HOSTS = new Set(['portal.tradepolice.app', 'portal.localhost', 'localhost']);
const HQ_HOSTS = new Set(['hq.tradepolice.app', 'hq.localhost']);
const HQ_ENTRY_PATHS = new Set(['/', '/hq', '/hq/login']);

function normalizedHostname(hostname: string | null | undefined) {
  if (!hostname) return '';
  return hostname.toLowerCase().trim().split(':')[0];
}

export function isPortalHostname(hostname: string | null | undefined) {
  return PORTAL_HOSTS.has(normalizedHostname(hostname));
}

export function isHQHostname(hostname: string | null | undefined) {
  return HQ_HOSTS.has(normalizedHostname(hostname));
}

function matchesPath(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function isHQEntryPath(pathname: string) {
  return HQ_ENTRY_PATHS.has(pathname);
}

export function getHQEntryDestination(input: {
  pathname: string;
  authenticated: boolean;
  pendingInvitation: boolean;
  workspaceRoute: string | null;
  accessError?: boolean;
}) {
  if (!input.authenticated) return input.pathname === '/hq/login' ? null : '/hq/login';
  if (input.pendingInvitation) return '/hq/onboarding';
  if (input.workspaceRoute) return input.workspaceRoute === input.pathname ? null : input.workspaceRoute;
  if (input.pathname === '/hq/login' && input.accessError) return null;
  return '/hq/login?error=access';
}

export function getHostnameRoutingDecision(hostname: string | null | undefined, pathname: string) {
  const isPortal = isPortalHostname(hostname);
  const isHQ = isHQHostname(hostname);
  const isHQPath = ['/hq','/admin','/staff','/api/hq'].some(route=>matchesPath(pathname,route));
  const isSharedAuthPath = ['/auth/callback','/forgot-password','/reset-password'].some(route=>matchesPath(pathname,route));
  const isPortalPath = !isSharedAuthPath && ['/dashboard','/validate','/active-trade','/history','/analytics','/account','/accounts','/profile','/billing','/onboarding','/complete-profile','/client/login'].some(route=>matchesPath(pathname,route));

  if (isHQ) {
    return { mode: 'hq' as const, redirectTarget: isPortalPath ? 'portal' as const : undefined, isPortalPath, isHQPath };
  }

  if (isPortal) {
    return { mode: 'portal' as const, redirectTarget: isHQPath ? 'hq' as const : undefined, isPortalPath, isHQPath };
  }

  return {
    mode: 'marketing' as const,
    redirectTarget: isHQPath ? 'hq' as const : isPortalPath ? 'portal' as const : undefined,
    isPortalPath,
    isHQPath,
  };
}
