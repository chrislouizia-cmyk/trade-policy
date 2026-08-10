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

export function getCanonicalAppUrls(env: Record<string, string | undefined> = process.env): CanonicalAppUrls {
  return {
    site: origin(env.NEXT_PUBLIC_SITE_URL, 'https://tradepolice.app'),
    portal: origin(env.NEXT_PUBLIC_APP_URL, 'https://portal.tradepolice.app'),
    hq: origin(env.NEXT_PUBLIC_HQ_URL, 'https://hq.tradepolice.app'),
  };
}
