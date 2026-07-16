'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

export default function ForgotPasswordPage() {
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const error = new URLSearchParams(window.location.search).get('error');
    if (error) {
      setIsError(true);
      setMessage(error === 'invalid-link'
        ? 'This recovery link is invalid or expired. Request a new one below.'
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
    const redirectTo = `${window.location.origin}/auth/callback?next=/reset-password&type=recovery`;
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });

    if (error) {
      setIsError(true);
      setMessage(error.message);
    } else {
      setMessage('Recovery email sent. Open the newest email and use its link to choose a new password.');
    }
    setLoading(false);
  }

  return (
    <main className="login-shell">
      <form className="card login-card" onSubmit={submit}>
        <div className="brand">TRADE POLICE</div>
        <h1>Recover password</h1>
        <p className="muted">Enter the email used for your Trade Police account.</p>
        <label>
          Email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <button className="primary" disabled={loading}>
          {loading ? 'Sending…' : 'Send recovery email'}
        </button>
        {message && <p className={isError ? 'warning' : 'success'}>{message}</p>}
        <Link className="link-button" href="/client/login">Back to sign in</Link>
      </form>
    </main>
  );
}
