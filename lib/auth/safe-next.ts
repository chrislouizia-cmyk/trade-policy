export function getSafeClientNextPath(
  value: string | null | undefined,
  currentPath?: string,
  fallback = '/dashboard',
) {
  const raw = typeof value === 'string' ? value.trim() : '';

  if (!raw) return fallback;
  if (raw.startsWith('//')) return fallback;
  if (raw.startsWith('http://') || raw.startsWith('https://')) return fallback;
  if (/^javascript:/i.test(raw)) return fallback;
  if (!raw.startsWith('/')) return fallback;

  const pathname = raw.split('?')[0].split('#')[0];
  const blocked = new Set([
    '/',
    '/login',
    '/client/login',
    '/hq/login',
  ]);

  if (currentPath && pathname === currentPath) return fallback;
  if (blocked.has(pathname)) return fallback;

  return raw;
}
