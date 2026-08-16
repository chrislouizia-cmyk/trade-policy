'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function SignOutButton({ portal = 'client' }: { portal?: 'client' | 'hq' }) {
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const loginPath = portal === 'hq' ? '/hq/login?signedOut=1' : '/client/login?signedOut=1';

  async function signOut() {
    setBusy(true);
    setErrorMessage('');
    try {
      const { error } = await createClient().auth.signOut({ scope: 'local' });
      if (error) throw error;
      window.location.replace(loginPath);
    } catch {
      setBusy(false);
      setErrorMessage('Sign out failed. You are still signed in. Please try again.');
    }
  }

  return <div className="sign-out-control">
    <button type="button" onClick={signOut} disabled={busy}>{busy ? 'Signing out…' : 'Sign out'}</button>
    {errorMessage ? <span className="error" role="alert">{errorMessage}</span> : null}
  </div>;
}
