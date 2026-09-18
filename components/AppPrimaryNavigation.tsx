'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale } from '@/components/i18n/LocaleProvider';

const navigationItems = [
  { href: '/dashboard', labelKey: 'nav.dashboard' },
  { href: '/validate', labelKey: 'nav.decision' },
  { href: '/active-trade', labelKey: 'nav.activeTrade' },
  { href: '/history', labelKey: 'nav.history' },
  { href: '/profile', labelKey: 'nav.strategies' },
  { href: '/marketplace', labelKey: 'nav.marketplace' },
  { href: '/analytics', labelKey: 'nav.analytics' },
  { href: '/accounts', labelKey: 'nav.tradingAccounts' },
  { href: '/account', labelKey: 'nav.account' },
] as const;

function isRouteActive(pathname: string, href: string) {
  if (href === '/dashboard') return pathname === '/dashboard' || pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AppPrimaryNavigation({ activeTradeCount = 0 }: { activeTradeCount?: number }) {
  const pathname = usePathname();
  const { t } = useLocale();

  return (
    <nav className="primary-nav shell-primary-nav canonical-shell-nav canonical-visible-nav" aria-label="Primary navigation">
      {navigationItems.map((item) => {
        const active = isRouteActive(pathname, item.href);
        return (
          <Link key={item.href} href={item.href} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined}>
            {t(item.labelKey)}
            {item.href === '/active-trade' && activeTradeCount > 0 ? <span className="nav-badge">{activeTradeCount}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
