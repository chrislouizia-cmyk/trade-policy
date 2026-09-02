'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { LOCALE_COOKIE, normalizeLocale, type Locale, type LocalePreference } from '@/lib/i18n/config';
import { useLocale } from './LocaleProvider';

function browserLocale(): Locale {
  return normalizeLocale(navigator.languages?.[0] ?? navigator.language) ?? 'en';
}
export default function LanguagePreference({ userId, initialPreference }: { userId: string; initialPreference: LocalePreference }) {
  const router = useRouter();
  const { t } = useLocale();
  const [preference, setPreference] = useState<LocalePreference>(initialPreference);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');

  async function change(next: LocalePreference) {
    setPreference(next);
    setState('saving');
    const { error } = await createClient().from('profiles').update({ preferred_locale: next }).eq('id', userId);
    if (error) {
      setState('failed');
      return;
    }
    const resolved = next === 'auto' ? browserLocale() : next;
    document.cookie = `${LOCALE_COOKIE}=${resolved}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`;
    document.documentElement.lang = resolved;
    setState('saved');
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
      {state === 'saving' ? t('language.saving') : state === 'saved' ? t('language.saved') : state === 'failed' ? t('language.failed') : ''}
    </p>
  </section>;
}
