'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Locale } from '@/lib/i18n/config';
import { translate, type MessageKey } from '@/lib/i18n/messages';
import { getScreenCopy, type ScreenCopy } from '@/lib/i18n/screen-copy';

type LocaleContextValue = { locale: Locale; t: (key: MessageKey) => string; copy: ScreenCopy };
const LocaleContext = createContext<LocaleContextValue | null>(null);

export default function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo(() => ({ locale, t: (key: MessageKey) => translate(locale, key), copy: getScreenCopy(locale) }), [locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}
export function useLocale() {
  const value = useContext(LocaleContext);
  if (!value) throw new Error('useLocale must be used inside LocaleProvider.');
  return value;
}
