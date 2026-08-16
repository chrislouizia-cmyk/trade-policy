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

  return {
    site: previewOrigin ?? origin(env.NEXT_PUBLIC_SITE_URL, 'https://tradepolice.app'),
    portal: previewOrigin ?? origin(env.NEXT_PUBLIC_APP_URL, 'https://portal.tradepolice.app'),
    hq: previewOrigin ?? origin(env.NEXT_PUBLIC_HQ_URL, 'https://hq.tradepolice.app'),
  };
}
