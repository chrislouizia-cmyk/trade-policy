import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Trade Police HQ',
  description: 'Trade Police executive operations.',
  manifest: '/hq/manifest.webmanifest',
  icons: {
    icon: [
      {
        url: '/brand/trade-police-hq-icon-512.png?v=2026-09-22',
        type: 'image/png',
        sizes: '512x512',
      },
    ],
    apple: [
      {
        url: '/brand/trade-police-hq-icon-180.png?v=2026-09-22',
        type: 'image/png',
        sizes: '180x180',
      },
    ],
  },
};

export default function HQMetadataLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
