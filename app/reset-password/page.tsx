'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

export default function ResetPasswordPage() {
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let mounted = true;

    async function establishRecoverySession() {
      const queryParams = new URLSearchParams(window.location.search);
      const queryError = queryParams.get('error') || queryParams.get('error_description');
      if (queryError) {
        if (mounted) {
          setMessage(queryError === 'invalid-link'
            ? 'This recovery link is invalid or expired. Request a new email.'
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
        window.history.replaceState({}, document.title, '/reset-password');
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
        window.history.replaceState({}, document.title, '/reset-password');
      }

      const { data, error } = await supabase.auth.getSession();
      if (!mounted) return;
      setReady(Boolean(data.session) && !error);
      if (error) setMessage(error.message);
      if (!data.session && !error) {
        setMessage('This recovery link is invalid or expired. Request a new email.');
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
      setMessage('Password must contain at least 8 characters.');
      setLoading(false);
      return;
    }
    if (password !== confirm) {
      setMessage('Passwords do not match.');
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
    setMessage('Password updated successfully. Redirecting to sign in…');
    window.setTimeout(() => window.location.assign('/client/login?password=updated'), 1000);
    setLoading(false);
  }

  return (
    <main className="login-shell">
      <form className="card login-card" onSubmit={submit}>
        <div className="brand">TRADE POLICE</div>
        <h1>Create a new password</h1>

        {checking ? (
          <p className="muted">Verifying your secure recovery link…</p>
        ) : ready ? (
          <>
            <p className="muted">Choose a secure password with at least 8 characters.</p>
            <label>
              New password
              <input name="password" type="password" minLength={8} autoComplete="new-password" required />
            </label>
            <label>
              Confirm password
              <input name="confirm" type="password" minLength={8} autoComplete="new-password" required />
            </label>
            <button className="primary" disabled={loading}>
              {loading ? 'Saving…' : 'Save new password'}
            </button>
          </>
        ) : (
          <div className="warning">This recovery link cannot be used. Request a new password email below.</div>
        )}

        {message && <p className={message.startsWith('Password updated') ? 'success' : 'warning'}>{message}</p>}
        {!ready && !checking && <Link href="/forgot-password">Request another recovery email</Link>}
        <Link href="/client/login">Back to sign in</Link>
      </form>
    </main>
  );
}
