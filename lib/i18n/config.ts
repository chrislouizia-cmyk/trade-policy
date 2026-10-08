export const SUPPORTED_LOCALES = ['en', 'es', 'fr'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];
export type LocalePreference = Locale | 'auto';

export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_COOKIE = 'trade-police-locale';

export function normalizeLocale(value?: string | null): Locale | null {
  if (!value) return null;
  const base = value.trim().toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_LOCALES.includes(base as Locale) ? base as Locale : null;
}
export function detectLocale(acceptLanguage?: string | null): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const candidates = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag, ...parameters] = part.trim().split(';');
      const quality = parameters.find((item) => item.trim().startsWith('q='));
      return { locale: normalizeLocale(tag), quality: quality ? Number(quality.split('=')[1]) : 1 };
    })
    .filter((candidate): candidate is { locale: Locale; quality: number } => Boolean(candidate.locale))
    .sort((left, right) => right.quality - left.quality);
  return candidates[0]?.locale ?? DEFAULT_LOCALE;
}
