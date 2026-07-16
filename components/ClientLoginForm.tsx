'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

export default function ClientLoginForm({ next }: { next: string }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
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
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/complete-profile`,
          data: { account_type: 'customer' },
        },
      });
      setMessage(error?.message || 'Customer account created. Check your email if confirmation is enabled.');
      setLoading(false);
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
