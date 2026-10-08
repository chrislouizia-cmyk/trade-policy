'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

export default function HQLoginForm() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');

    const form = new FormData(event.currentTarget);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: String(form.get('email') || '').trim(),
      password: String(form.get('password') || ''),
    });

    if (error) {
      setBusy(false);
      setMessage('The email or password is incorrect.');
      return;
    }

    const { data: invitation } = await supabase.rpc('current_staff_invitation_onboarding_v1');
    if (invitation) {
      window.location.assign('/hq/onboarding');
      return;
    }

    const { data: route, error: routeError } = await supabase.rpc('staff_workspace_route');
    if (routeError || !route) {
      await supabase.auth.signOut();
      setBusy(false);
      setMessage('This account is not authorized for Trade Police Headquarters. Customers must use the client portal.');
      return;
    }

    const [{ data: mfaRequired }, { data: assurance }] = await Promise.all([
      supabase.rpc('current_staff_mfa_requirement'),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ]);
    if (mfaRequired && assurance?.currentLevel !== 'aal2') {
      window.location.assign('/hq/mfa');
      return;
    }

    window.location.assign(String(route));
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label>
        Employee email
        <input name="email" type="email" autoComplete="email" required placeholder="name@company.com" />
      </label>
      <label>
        Password
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Enter Headquarters'}</button>
      {message && <p className="error">{message}</p>}
      <Link href="/forgot-password?portal=hq">Forgot password?</Link>
    </form>
  );
}
