import './trade-police.css';
import type { Metadata } from 'next';
import AppFooter from '@/components/AppFooter';

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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><div className="app-document-content">{children}</div><AppFooter /></body></html>;
}
