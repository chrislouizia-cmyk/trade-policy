'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import SignOutButton from '@/components/SignOutButton';

type MobileBottomNavProps = {
  activeTradeCount?: number;
};

const primaryItems = [
  { href: '/dashboard', label: 'Home', icon: 'home' },
  { href: '/validate', label: 'Decision', icon: 'decision' },
  { href: '/active-trade', label: 'Active', icon: 'active' },
  { href: '/history', label: 'History', icon: 'history' },
] as const;

const moreItems = [
  { href: '/profile', label: 'Strategies', description: 'Playbooks and trading rules' },
  { href: '/analytics', label: 'Analytics', description: 'Performance and discipline' },
  { href: '/accounts', label: 'Trading accounts', description: 'Risk accounts and balances' },
  { href: '/account', label: 'Account', description: 'Plan, language and settings' },
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
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></svg>;
}

function isRouteActive(pathname: string, href: string) {
  if (href === '/dashboard') return pathname === '/dashboard' || pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function MobileBottomNav({ activeTradeCount = 0 }: MobileBottomNavProps) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setMoreOpen(false);
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
                <h2>More</h2>
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
                    <strong>{item.label}</strong>
                    <small>{item.description}</small>
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

      <nav className="mobile-bottom-nav" aria-label="Mobile primary navigation">
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
              <span>{item.label}</span>
            </Link>
          );
        })}

        <button
          type="button"
          className={moreOpen ? 'active' : ''}
          onClick={() => setMoreOpen(true)}
          aria-expanded={moreOpen}
        >
          <span className="mobile-nav-icon"><NavIcon name="more" /></span>
          <span>More</span>
        </button>
      </nav>
    </>
  );
}
