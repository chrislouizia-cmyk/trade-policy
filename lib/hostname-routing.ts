const PORTAL_HOSTS = new Set(['portal.tradepolice.app', 'portal.localhost', 'localhost']);
const MARKETING_HOSTS = new Set(['tradepolice.app', 'www.tradepolice.app', 'www.localhost']);

export function isPortalHostname(hostname: string | null | undefined) {
  if (!hostname) return false;
  const normalized = hostname.toLowerCase().trim();
  if (normalized.includes(':')) {
    return PORTAL_HOSTS.has(normalized.split(':')[0]);
  }
  return PORTAL_HOSTS.has(normalized);
}

export function getHostnameRoutingDecision(hostname: string | null | undefined, pathname: string) {
  const isPortal = isPortalHostname(hostname);
  const isPortalPath = pathname.startsWith('/dashboard') || pathname.startsWith('/validate') || pathname.startsWith('/active-trade') || pathname.startsWith('/history') || pathname.startsWith('/analytics') || pathname.startsWith('/account') || pathname.startsWith('/accounts') || pathname.startsWith('/profile') || pathname.startsWith('/billing') || pathname.startsWith('/onboarding') || pathname.startsWith('/complete-profile') || pathname.startsWith('/client/login') || pathname.startsWith('/login') || pathname.startsWith('/auth') || pathname.startsWith('/api');

  if (isPortal) {
    return { mode: 'portal' as const, redirectToPortal: undefined, isPortalPath };
  }

  return {
    mode: 'marketing' as const,
    redirectToPortal: isPortalPath,
    isPortalPath,
  };
}
