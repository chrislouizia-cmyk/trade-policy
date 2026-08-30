'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

function signupErrorMessage(error: unknown) {
  const candidate = error as { message?: unknown; code?: unknown; status?: unknown } | null;
  const raw = typeof candidate?.message === 'string' ? candidate.message.trim() : '';
  if (raw && raw !== '{}' && raw !== '[object Object]') return raw;
  return 'We could not create the account. Please try again. If the problem continues, contact Trade Police support.';
}

export default function ClientLoginForm({ next, initialMode='login' }: { next: string; initialMode?:'login'|'signup' }) {
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
          setMessage(signupErrorMessage(error));
        } else if (data.session) {
          window.location.assign('/onboarding');
          return;
        } else {
          setMessage('Customer account created. Check your email to confirm your account.');
        }
      } catch (error) {
        console.error('[CUSTOMER_SIGNUP_FAILED]', error);
        setMessage(signupErrorMessage(error));
      } finally {
        setLoading(false);
      }
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setMessage('The email or password is incorrect.');
      setLoading(false);
      return;
    }

    const { data: staffRole } = await supabase.rpc('current_staff_role');
    if (staffRole) {
      await supabase.auth.signOut();
      setMessage('This account cannot access the client portal. Please use your authorized access link.');
      setLoading(false);
      return;
    }

    const { data: profile } = await supabase.from('profiles').select('profile_completed').maybeSingle();
    window.location.assign(profile?.profile_completed ? next : '/complete-profile');
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label>
        Customer email
        <input name="email" type="email" autoComplete="email" required />
      </label>
      <label>
        Password
        <input name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} required />
      </label>
      <button className="primary" disabled={loading}>
        {loading ? 'Please wait…' : mode === 'login' ? 'Enter client portal' : 'Create customer account'}
      </button>
      {message && <p className="warning">{message}</p>}
      {mode === 'login' && <Link href="/forgot-password?portal=client">Forgot password?</Link>}
      <button type="button" className="link-button" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
        {mode === 'login' ? 'Create a customer account' : 'I already have a customer account'}
      </button>
    </form>
  );
}
