import './trade-police.css';
import './product-premium.css';
import './hq-premium.css';
import './mobile-shell.css';
import './liquid-glass.css';
import type { Metadata, Viewport } from 'next';
import AppFooter from '@/components/AppFooter';
import LocaleProvider from '@/components/i18n/LocaleProvider';
import LocaleSynchronizer from '@/components/i18n/LocaleSynchronizer';
import { getRequestLocale } from '@/lib/i18n/server';

export const metadata: Metadata = {
  title: 'Trade Police',
  description: 'No trade without evidence.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icon.png?v=2026-09-22-center', type: 'image/png', sizes: '512x512' },
      { url: '/favicon.ico?v=2026-09-22-center', sizes: 'any' },
    ],
    apple: [{ url: '/apple-icon.png?v=2026-09-22-center', type: 'image/png', sizes: '180x180' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getRequestLocale();
  return <html lang={locale}><body><LocaleProvider locale={locale}><LocaleSynchronizer/><div className="app-document-content">{children}<AppFooter /></div></LocaleProvider></body></html>;
}
