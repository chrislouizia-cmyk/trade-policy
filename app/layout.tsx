import './trade-police.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Trade Police',
  description: 'No trade without evidence.'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
