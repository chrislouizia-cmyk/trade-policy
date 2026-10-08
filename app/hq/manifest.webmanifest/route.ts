import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

const hqManifest = {
  id: '/hq',
  name: 'Trade Police HQ',
  short_name: 'TP HQ',
  description: 'Trade Police executive operations.',
  start_url: '/hq',
  scope: '/hq',
  display: 'standalone',
  background_color: '#070503',
  theme_color: '#070503',
  icons: [
    {
      src: '/brand/trade-police-hq-icon-192.png?v=2026-09-22',
      sizes: '192x192',
      type: 'image/png',
      purpose: 'any',
    },
    {
      src: '/brand/trade-police-hq-icon-512.png?v=2026-09-22',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'any',
    },
    {
      src: '/brand/trade-police-hq-icon-512.png?v=2026-09-22',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    },
  ],
} satisfies MetadataRoute.Manifest;

export function GET() {
  return new Response(JSON.stringify(hqManifest), {
    headers: {
      'Content-Type': 'application/manifest+json',
      'Cache-Control': 'public, max-age=3600, must-revalidate',
    },
  });
}
