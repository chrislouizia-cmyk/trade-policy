import './trade-police.css';
import type { Metadata } from 'next';
import AppFooter from '@/components/AppFooter';

export const metadata: Metadata = {
  title: 'Trade Police',
  description: 'No trade without evidence.'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><div className="app-document-content">{children}</div><AppFooter /></body></html>;
}
