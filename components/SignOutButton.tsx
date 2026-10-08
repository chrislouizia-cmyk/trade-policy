'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useLocale } from '@/components/i18n/LocaleProvider';
import { LOCALE_COOKIE } from '@/lib/i18n/config';

export default function SignOutButton({ portal = 'client' }: { portal?: 'client' | 'hq' }) {
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const { t } = useLocale();
  const loginPath = portal === 'hq' ? '/hq/login?signedOut=1' : '/client/login?signedOut=1';

  async function signOut() {
    setBusy(true);
    setErrorMessage('');
    try {
      const { error } = await createClient().auth.signOut({ scope: 'local' });
      if (error) throw error;
      document.cookie = `${LOCALE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; Secure`;
      window.location.replace(loginPath);
    } catch {
      setBusy(false);
      setErrorMessage(t('auth.signOutFailed') || 'Sign out failed. You are still signed in. Please try again.');
    }
  }

  return <div className="sign-out-control">
    <button type="button" onClick={signOut} disabled={busy}>{busy ? t('auth.signingOut') : t('auth.signOut')}</button>
    {errorMessage ? <span className="error" role="alert">{errorMessage}</span> : null}
  </div>;
}
