'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import {useLocale} from '@/components/i18n/LocaleProvider';
import {getAuthCopy} from '@/lib/i18n/auth-copy';

export default function ForgotPasswordPage() {
  const {locale}=useLocale(); const c=getAuthCopy(locale);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [portal, setPortal] = useState<'client' | 'hq'>('client');

  useEffect(() => {
    const error = new URLSearchParams(window.location.search).get('error');
    setPortal(new URLSearchParams(window.location.search).get('portal') === 'hq' ? 'hq' : 'client');
    if (error) {
      setIsError(true);
      setMessage(error === 'invalid-link'
        ? c.invalidLink
        : decodeURIComponent(error));
    }
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    setIsError(false);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get('email') ?? '').trim();
    const redirectTo = new URL('/auth/callback', window.location.origin);
    redirectTo.searchParams.set('next', `/reset-password?portal=${portal}`);
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: redirectTo.toString() });

    if (error) {
      setIsError(true);
      setMessage(error.message);
    } else {
      setMessage(c.recoverySent);
    }
    setLoading(false);
  }

  return (
    <main className="login-shell">
      <form className="card login-card" onSubmit={submit}>
        <div className="brand">TRADE POLICE</div>
        <h1>{c.recover}</h1>
        <p className="muted">{c.recoverIntro}</p>
        <label>
          {c.email}
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <button className="primary" disabled={loading}>
          {loading ? c.sending : c.sendRecovery}
        </button>
        {message && <p className={isError ? 'warning' : 'success'}>{message}</p>}
        <Link className="link-button" href={portal === 'hq' ? '/hq/login' : '/client/login'}>{c.back}</Link>
      </form>
    </main>
  );
}
