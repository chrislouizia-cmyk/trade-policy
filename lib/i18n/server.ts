import 'server-only';
import { cookies, headers } from 'next/headers';
import { detectLocale, LOCALE_COOKIE, normalizeLocale, type Locale } from './config';
import { translate } from './messages';

export async function getRequestLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const saved = normalizeLocale(cookieStore.get(LOCALE_COOKIE)?.value);
  if (saved) return saved;
  const headerStore = await headers();
  return detectLocale(headerStore.get('accept-language'));
}
export async function getServerTranslator() {
  const locale = await getRequestLocale();
  return { locale, t: (key: Parameters<typeof translate>[1]) => translate(locale, key) };
}
