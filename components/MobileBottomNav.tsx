'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import SignOutButton from '@/components/SignOutButton';
import { useLocale } from '@/components/i18n/LocaleProvider';

type MobileBottomNavProps = {
  activeTradeCount?: number;
};

const primaryItems = [
  { href: '/dashboard', labelKey: 'nav.dashboard', icon: 'home' },
  { href: '/validate', labelKey: 'nav.decision', icon: 'decision' },
  { href: '/active-trade', labelKey: 'nav.activeTrade', icon: 'active' },
] as const;

const moreItems = [
  { href: '/history', labelKey: 'nav.history', descriptionKey: 'nav.journalDescription', icon: 'history' },
  { href: '/profile', labelKey: 'nav.strategies', descriptionKey: 'nav.strategiesDescription', icon: 'strategies' },
  { href: '/analytics', labelKey: 'nav.analytics', descriptionKey: 'nav.analyticsDescription', icon: 'performance' },
  { href: '/accounts', labelKey: 'nav.tradingAccounts', descriptionKey: 'nav.accountsDescription', icon: 'accounts' },
  { href: '/account', labelKey: 'nav.account', descriptionKey: 'nav.settingsDescription', icon: 'settings' },
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
  if (name === 'performance') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19V12M12 19V5M19 19V9" /></svg>;
  }
  if (name === 'accounts') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16v12H4zM4 10h16M7 15h4" /></svg>;
  }
  if (name === 'settings') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /></svg>;
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></svg>;
}

function isRouteActive(pathname: string, href: string) {
  if (href === '/dashboard') return pathname === '/dashboard' || pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function MobileBottomNav({ activeTradeCount = 0 }: MobileBottomNavProps) {
  const pathname = usePathname();
  const { t } = useLocale();
  const [moreOpen, setMoreOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const navigationRef = useRef<HTMLElement>(null);
  const secondaryRouteActive = moreItems.some((item) => isRouteActive(pathname, item.href));

  useEffect(() => {
    setMoreOpen(false);
    navigationRef.current
      ?.querySelector<HTMLElement>('[aria-current="page"]')
      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [moreOpen]);

  return (
    <>
      {moreOpen ? (
        <div className="mobile-more-backdrop" role="presentation" onClick={() => setMoreOpen(false)}>
          <section
            className="mobile-more-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="More Trade Police navigation"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mobile-more-handle" />
            <header>
              <div>
                <span className="eyebrow">TRADE POLICE</span>
                <h2>{t('nav.more')}</h2>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                className="mobile-more-close"
                onClick={() => setMoreOpen(false)}
                aria-label="Close more navigation"
              >
                ×
              </button>
            </header>

            <nav aria-label="More navigation">
              {moreItems.map((item) => (
                <Link key={item.href} href={item.href} className={isRouteActive(pathname, item.href) ? 'active' : ''}>
                  <span>
                    <strong>{t(item.labelKey)}</strong>
                    <small>{t(item.descriptionKey)}</small>
                  </span>
                  <b aria-hidden="true">›</b>
                </Link>
              ))}
            </nav>
            <button
              type="button"
              className="mobile-more-feedback"
              onClick={() => {
                setMoreOpen(false);
                window.dispatchEvent(new Event('trade-police:feedback-open'));
              }}
            >
              Send feedback
            </button>
            <div className="mobile-more-session">
              <SignOutButton />
            </div>
          </section>
        </div>
      ) : null}

      <nav ref={navigationRef} className="mobile-bottom-nav" aria-label="Mobile primary navigation">
        {primaryItems.map((item) => {
          const active = isRouteActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
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

        <button
          type="button"
          className={moreOpen || secondaryRouteActive ? 'active' : ''}
          onClick={() => setMoreOpen(true)}
          aria-expanded={moreOpen}
        >
          <span className="mobile-nav-icon"><NavIcon name="more" /></span>
          <span>{t('nav.more')}</span>
        </button>

        {moreItems.map((item) => {
          const active = isRouteActive(pathname, item.href);
          return (
            <Link
              key={`rail-${item.href}`}
              href={item.href}
              className={`mobile-nav-secondary ${active ? 'active' : ''}`}
              aria-current={active ? 'page' : undefined}
            >
              <span className="mobile-nav-icon"><NavIcon name={item.icon} /></span>
              <span>{t(item.labelKey)}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
