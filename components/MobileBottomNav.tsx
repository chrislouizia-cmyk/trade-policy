'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale } from '@/components/i18n/LocaleProvider';

type MobileBottomNavProps = {
  activeTradeCount?: number;
};

const primaryItems = [
  { href: '/dashboard', labelKey: 'nav.dashboard', icon: 'home' },
  { href: '/validate', labelKey: 'nav.decision', icon: 'decision' },
  { href: '/active-trade', labelKey: 'nav.activeTrade', icon: 'active' },
  { href: '/history', labelKey: 'nav.history', icon: 'history' },
  { href: '/profile', labelKey: 'nav.strategies', icon: 'strategies' },
] as const;

function NavIcon({ name }: { name: string }) {
  if (name === 'home') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 10.8 12 4l8.5 6.8v8.7a.5.5 0 0 1-.5.5h-5v-5.5H9V20H4a.5.5 0 0 1-.5-.5z" /></svg>;
  }
  if (name === 'decision') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v16H5zM8 8h8M8 12h5M8 16h7" /></svg>;
  }
  if (name === 'active') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l2-5 4 10 2-5h6" /></svg>;
  }
  if (name === 'history') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7v5h5M5.7 16.8A8 8 0 1 0 5 8.2L4 12M12 8v4l3 2" /></svg>;
  }
  if (name === 'strategies') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v4H5zM5 11h14v8H5zM8 14h8M8 17h5" /></svg>;
  }
  return null;
}

function isRouteActive(pathname: string, href: string) {
  if (href === '/profile' && pathname.startsWith('/strategies/')) return true;
  if (href === '/dashboard') return pathname === '/dashboard' || pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function MobileBottomNav({ activeTradeCount = 0 }: MobileBottomNavProps) {
  const pathname = usePathname();
  const { t } = useLocale();

  return (
    <>
      <div className="mobile-nav-backplate" aria-hidden="true" />
      <nav
        className="mobile-bottom-nav"
        aria-label="Mobile primary navigation"
      >
        {primaryItems.map((item) => {
          const active = isRouteActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch
              className={active ? 'active' : ''}
              aria-current={active ? 'page' : undefined}
            >
              <span className="mobile-nav-icon">
                <NavIcon name={item.icon} />
                {item.href === '/active-trade' && activeTradeCount > 0 ? <i>{activeTradeCount}</i> : null}
              </span>
              <span>{t(item.labelKey)}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
