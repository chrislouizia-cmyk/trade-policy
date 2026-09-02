'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { LOCALE_COOKIE, normalizeLocale, type Locale } from '@/lib/i18n/config';
import { useLocale } from './LocaleProvider';

function browserLocale(): Locale {
  return normalizeLocale(navigator.languages?.[0] ?? navigator.language) ?? 'en';
}

export default function LocaleSynchronizer() {
  const router = useRouter();
  const { locale } = useLocale();
  useEffect(() => {
    let active = true;
    void (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!active || !user) return;
      const { data } = await supabase.from('profiles').select('preferred_locale').eq('id', user.id).maybeSingle();
      if (!active || !data) return;
      const resolved = data.preferred_locale === 'auto' ? browserLocale() : normalizeLocale(data.preferred_locale);
      if (!resolved || resolved === locale) return;
      document.cookie = `${LOCALE_COOKIE}=${resolved}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`;
      document.documentElement.lang = resolved;
      router.refresh();
    })();
    return () => { active = false; };
  }, [locale, router]);
  return null;
}
