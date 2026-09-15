'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale } from '@/components/i18n/LocaleProvider';

const coreItems = [
  { href: '/dashboard', labelKey: 'nav.dashboard' },
  { href: '/validate', labelKey: 'nav.decision' },
  { href: '/active-trade', labelKey: 'nav.activeTrade' },
  { href: '/history', labelKey: 'nav.history' },
] as const;

const secondaryItems = [
  { href: '/profile', labelKey: 'nav.strategies', descriptionKey: 'nav.strategiesDescription' },
  { href: '/analytics', labelKey: 'nav.analytics', descriptionKey: 'nav.analyticsDescription' },
  { href: '/accounts', labelKey: 'nav.tradingAccounts', descriptionKey: 'nav.accountsDescription' },
  { href: '/account', labelKey: 'nav.account', descriptionKey: 'nav.settingsDescription' },
] as const;

function isRouteActive(pathname: string, href: string) {
  if (href === '/dashboard') return pathname === '/dashboard' || pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AppPrimaryNavigation({ activeTradeCount = 0 }: { activeTradeCount?: number }) {
  const pathname = usePathname();
  const { t } = useLocale();
  const secondaryActive = secondaryItems.some((item) => isRouteActive(pathname, item.href));

  return (
    <nav className="primary-nav shell-primary-nav canonical-shell-nav canonical-visible-nav" aria-label="Primary navigation">
      {coreItems.map((item) => {
        const active = isRouteActive(pathname, item.href);
        return (
          <Link key={item.href} href={item.href} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined}>
            {t(item.labelKey)}
            {item.href === '/active-trade' && activeTradeCount > 0 ? <span className="nav-badge">{activeTradeCount}</span> : null}
          </Link>
        );
      })}
      <details className={`desktop-more-nav ${secondaryActive ? 'active' : ''}`}>
        <summary>{t('nav.more')} <span aria-hidden="true">⌄</span></summary>
        <div>
          {secondaryItems.map((item) => (
            <Link key={item.href} href={item.href} className={isRouteActive(pathname, item.href) ? 'active' : ''}>
              <span>{t(item.labelKey)}<small>{t(item.descriptionKey)}</small></span>
              <b aria-hidden="true">›</b>
            </Link>
          ))}
        </div>
      </details>
    </nav>
  );
}
