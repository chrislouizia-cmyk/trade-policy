import './trade-police.css';
import type { Metadata } from 'next';
import AppFooter from '@/components/AppFooter';

export const metadata: Metadata = {
  title: 'Trade Police',
  description: 'No trade without evidence.',
  icons: {
    icon: [
      { url: '/icon.png', type: 'image/png' },
      { url: '/favicon.ico', sizes: 'any' },
    ],
    apple: '/apple-icon.png',
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><div className="app-document-content">{children}</div><AppFooter /></body></html>;
}
