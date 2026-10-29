'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import {useLocale} from '@/components/i18n/LocaleProvider';
import {getAuthCopy} from '@/lib/i18n/auth-copy';

export default function ResetPasswordPage() {
  const {locale}=useLocale(); const c=getAuthCopy(locale);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [ready, setReady] = useState(false);
  const [portal, setPortal] = useState<'client' | 'hq'>('client');

  useEffect(() => {
    const supabase = createClient();
    let mounted = true;

    async function establishRecoverySession() {
      const queryParams = new URLSearchParams(window.location.search);
      setPortal(queryParams.get('portal') === 'hq' ? 'hq' : 'client');
      const queryError = queryParams.get('error') || queryParams.get('error_description');
      if (queryError) {
        if (mounted) {
          setMessage(queryError === 'invalid-link'
            ? c.invalidLink
            : decodeURIComponent(queryError));
          setReady(false);
          setChecking(false);
        }
        return;
      }

      const code = queryParams.get('code');
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          if (mounted) { setMessage(exchangeError.message); setReady(false); setChecking(false); }
          return;
        }
        window.history.replaceState({}, document.title, `/reset-password?portal=${queryParams.get('portal') === 'hq' ? 'hq' : 'client'}`);
      }

      // Support legacy/implicit recovery links that contain tokens in the URL hash.
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const accessToken = hash.get('access_token');
      const refreshToken = hash.get('refresh_token');
      const hashError = hash.get('error_description') || hash.get('error');

      if (hashError) {
        if (mounted) {
          setMessage(decodeURIComponent(hashError));
          setReady(false);
          setChecking(false);
        }
        return;
      }

      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (error) {
          if (mounted) {
            setMessage(error.message);
            setReady(false);
            setChecking(false);
          }
          return;
        }
        const nextPortal = queryParams.get('portal') === 'hq' ? 'hq' : 'client';
        window.history.replaceState({}, document.title, `/reset-password?portal=${nextPortal}`);
      }

      const { data, error } = await supabase.auth.getSession();
      if (!mounted) return;
      setReady(Boolean(data.session) && !error);
      if (error) setMessage(error.message);
      if (!data.session && !error) {
        setMessage(c.invalidLink);
      }
      setChecking(false);
    }

    void establishRecoverySession();

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) {
        setReady(true);
        setMessage('');
        setChecking(false);
      }
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage('');

    const formData = new FormData(event.currentTarget);
    const password = String(formData.get('password') ?? '');
    const confirm = String(formData.get('confirm') ?? '');

    if (password.length < 8) {
      setMessage(c.passwordLength);
      setLoading(false);
      return;
    }
    if (password !== confirm) {
      setMessage(c.passwordMismatch);
      setLoading(false);
      return;
    }

    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setMessage(error.message);
      setLoading(false);
      return;
    }

    await supabase.auth.signOut();
    setMessage(c.passwordUpdated);
    window.setTimeout(() => window.location.assign(portal === 'hq' ? '/hq/login?password=updated' : '/client/login?password=updated'), 1000);
    setLoading(false);
  }

  return (
    <main className="login-shell">
      <form className="card login-card" onSubmit={submit}>
        <div className="brand">TRADE POLICE</div>
        <h1>{c.newPasswordTitle}</h1>

        {checking ? (
          <p className="muted">{c.verifying}</p>
        ) : ready ? (
          <>
            <p className="muted">{c.choosePassword}</p>
            <label>
              {c.newPassword}
              <input name="password" type="password" minLength={8} autoComplete="new-password" required />
            </label>
            <label>
              {c.confirmPassword}
              <input name="confirm" type="password" minLength={8} autoComplete="new-password" required />
            </label>
            <button className="primary" disabled={loading}>
              {loading ? c.saving : c.savePassword}
            </button>
          </>
        ) : (
          <div className="warning">{c.unusable}</div>
        )}

        {message && <p className={message === c.passwordUpdated ? 'success' : 'warning'}>{message}</p>}
        {!ready && !checking && <Link href="/forgot-password">{c.requestAgain}</Link>}
        <Link href={portal === 'hq' ? '/hq/login' : '/client/login'}>{c.back}</Link>
      </form>
    </main>
  );
}
