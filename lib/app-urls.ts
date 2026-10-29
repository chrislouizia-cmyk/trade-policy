export type CanonicalAppUrls = {
  site: string;
  portal: string;
  hq: string;
};

function origin(value: string | undefined, fallback: string) {
  try {
    return new URL(value || fallback).origin;
  } catch {
    return fallback;
  }
}

function currentPreviewOrigin(env: Record<string, string | undefined>) {
  const candidate = env.NEXT_PUBLIC_VERCEL_URL || env.VERCEL_URL;
  if (!candidate) return null;
  const host = candidate.replace(/^https?:\/\//, '').trim();
  if (!host) return null;
  return `https://${host}`;
}

export function getCanonicalAppUrls(env: Record<string, string | undefined> = process.env): CanonicalAppUrls {
  const isPreview = env.VERCEL_ENV === 'preview';
  const previewOrigin = isPreview ? currentPreviewOrigin(env) : null;
  const siteOrigin = previewOrigin ?? origin(env.NEXT_PUBLIC_SITE_URL, 'https://tradepolice.app');
  const appOrigin = previewOrigin ?? origin(env.NEXT_PUBLIC_APP_URL, 'https://tradepolice.app');
  const normalizedPortalOrigin = appOrigin === 'https://portal.tradepolice.app' ? siteOrigin : appOrigin;

  return {
    site: siteOrigin,
    portal: normalizedPortalOrigin,
    hq: previewOrigin ?? origin(env.NEXT_PUBLIC_HQ_URL, 'https://hq.tradepolice.app'),
  };
}
