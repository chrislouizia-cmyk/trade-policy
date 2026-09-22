import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Trade Police',
    short_name: 'Trade Police',
    description: 'No trade without evidence.',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#030610',
    theme_color: '#030610',
    icons: [
      {
        src: '/brand/trade-police-app-icon-192.png?v=2026-09-22-center',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/brand/trade-police-app-icon-512.png?v=2026-09-22-center',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/brand/trade-police-app-icon-512.png?v=2026-09-22-center',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
