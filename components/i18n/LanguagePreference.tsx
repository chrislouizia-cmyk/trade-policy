'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { LOCALE_COOKIE, normalizeLocale, type Locale, type LocalePreference } from '@/lib/i18n/config';
import { translate } from '@/lib/i18n/messages';
import { useLocale } from './LocaleProvider';

function browserLocale(): Locale {
  return normalizeLocale(navigator.languages?.[0] ?? navigator.language) ?? 'en';
}
export default function LanguagePreference({ userId, initialPreference }: { userId: string; initialPreference: LocalePreference }) {
  const router = useRouter();
  const { t } = useLocale();
  const [preference, setPreference] = useState<LocalePreference>(initialPreference);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [statusMessage, setStatusMessage] = useState('');

  async function change(next: LocalePreference) {
    const resolved = next === 'auto' ? browserLocale() : next;
    setPreference(next);
    setState('saving');
    setStatusMessage(translate(resolved, 'language.saving'));
    const { data, error } = await createClient()
      .from('profiles')
      .update({ preferred_locale: next })
      .eq('id', userId)
      .select('preferred_locale')
      .maybeSingle();
    if (error || !data) {
      setPreference(initialPreference);
      setState('failed');
      setStatusMessage(translate(resolved, 'language.failed'));
      return;
    }
    document.cookie = `${LOCALE_COOKIE}=${resolved}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`;
    document.documentElement.lang = resolved;
    setState('saved');
    setStatusMessage(translate(resolved, 'language.saved'));
    router.refresh();
  }

  return <section className="card language-preference-card">
    <p className="eyebrow">{t('language.title')}</p>
    <h2>{t('language.title')}</h2>
    <p className="muted">{t('language.description')}</p>
    <label>
      <span className="sr-only">{t('language.title')}</span>
      <select value={preference} onChange={(event) => void change(event.target.value as LocalePreference)} disabled={state === 'saving'}>
        <option value="auto">{t('language.auto')}</option>
        <option value="en">{t('language.en')}</option>
        <option value="es">{t('language.es')}</option>
        <option value="fr">{t('language.fr')}</option>
      </select>
    </label>
    <p className={state === 'failed' ? 'error' : 'muted'} role="status" aria-live="polite">
      {statusMessage}
    </p>
  </section>;
}
