import './trade-police.css';
import './product-premium.css';
import './hq-premium.css';
import type { Metadata } from 'next';
import AppFooter from '@/components/AppFooter';
import LocaleProvider from '@/components/i18n/LocaleProvider';
import LocaleSynchronizer from '@/components/i18n/LocaleSynchronizer';
import { getRequestLocale } from '@/lib/i18n/server';

export const metadata: Metadata = {
  title: 'Trade Police',
  description: 'No trade without evidence.',
  icons: {
    icon: [
      { url: '/icon.png?v=2026-08-20', type: 'image/png' },
      { url: '/favicon.ico?v=2026-08-20', sizes: 'any' },
    ],
    apple: '/apple-icon.png?v=2026-08-20',
  },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getRequestLocale();
  return <html lang={locale}><body><LocaleProvider locale={locale}><LocaleSynchronizer/><div className="app-document-content">{children}</div><AppFooter /></LocaleProvider></body></html>;
}
