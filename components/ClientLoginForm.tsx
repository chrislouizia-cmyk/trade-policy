'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import {useLocale} from '@/components/i18n/LocaleProvider';
import {getAuthCopy} from '@/lib/i18n/auth-copy';

function signupErrorMessage(error: unknown, fallback: string) {
  const candidate = error as { message?: unknown; code?: unknown; status?: unknown } | null;
  const raw = typeof candidate?.message === 'string' ? candidate.message.trim() : '';
  if (raw && raw !== '{}' && raw !== '[object Object]') return raw;
  return fallback;
}

export default function ClientLoginForm({ next, initialMode='login' }: { next: string; initialMode?:'login'|'signup' }) {
  const {locale}=useLocale(); const c=getAuthCopy(locale);
  const [mode, setMode] = useState<'login' | 'signup'>(initialMode);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage('');

    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') || '').trim();
    const password = String(form.get('password') || '');
    const supabase = createClient();

    if (mode === 'signup') {
      try {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding`,
            data: { account_type: 'customer' },
          },
        });
        if (error) {
          console.error('[CUSTOMER_SIGNUP_FAILED]', { code: error.code, status: error.status, message: error.message });
          setMessage(signupErrorMessage(error,c.signupFailed));
        } else if (data.session) {
          window.location.assign('/onboarding');
          return;
        } else {
          setMessage(c.created);
        }
      } catch (error) {
        console.error('[CUSTOMER_SIGNUP_FAILED]', error);
        setMessage(signupErrorMessage(error,c.signupFailed));
      } finally {
        setLoading(false);
      }
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setMessage(c.badCredentials);
      setLoading(false);
      return;
    }

    const { data: staffRole } = await supabase.rpc('current_staff_role');
    if (staffRole) {
      await supabase.auth.signOut();
      setMessage(c.staffBlocked);
      setLoading(false);
      return;
    }

    const { data: profile } = await supabase.from('profiles').select('profile_completed').maybeSingle();
    window.location.assign(profile?.profile_completed ? next : '/complete-profile');
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label>
        {c.customerEmail}
        <input name="email" type="email" autoComplete="email" required />
      </label>
      <label>
        {c.password}
        <input name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} required />
      </label>
      <button className="primary" disabled={loading}>
        {loading ? c.wait : mode === 'login' ? c.enter : c.create}
      </button>
      {message && <p className="warning">{message}</p>}
      {mode === 'login' && <Link href="/forgot-password?portal=client">{c.forgot}</Link>}
      <button type="button" className="link-button" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
        {mode === 'login' ? c.createLink : c.existing}
      </button>
    </form>
  );
}
