'use client';

import { FormEvent, useEffect, useState } from 'react';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';

type Enrollment = {
  qrCode: string;
  secret: string;
};

export default function HQMfaForm() {
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('Preparing secure verification…');
  const [factorId, setFactorId] = useState('');
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);

  useEffect(() => {
    let active = true;
    async function prepare() {
      const supabase = createClient();
      const { data: assurance, error: assuranceError } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (!active) return;
      if (assuranceError) {
        setMessage('Secure verification could not be prepared. Please sign in again.');
        setBusy(false);
        return;
      }
      if (assurance.currentLevel === 'aal2') {
        window.location.replace('/hq');
        return;
      }

      const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
      if (!active) return;
      if (factorsError) {
        setMessage('Your authenticator factors could not be loaded.');
        setBusy(false);
        return;
      }
      const verified = factors.totp.find((factor) => factor.status === 'verified');
      if (verified) {
        setFactorId(verified.id);
        setMessage('Enter the six-digit code from your authenticator app.');
        setBusy(false);
        return;
      }

      const unverified = factors.all.filter(
        (factor) => factor.factor_type === 'totp' && factor.status === 'unverified',
      );
      await Promise.all(
        unverified.map((factor) => supabase.auth.mfa.unenroll({ factorId: factor.id })),
      );
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Trade Police HQ',
        issuer: 'Trade Police',
      });
      if (!active) return;
      if (error) {
        setMessage('Authenticator enrollment could not be started. Please try again.');
        setBusy(false);
        return;
      }
      setFactorId(data.id);
      setEnrollment({ qrCode: data.totp.qr_code, secret: data.totp.secret });
      setMessage('Scan the QR code, then enter the six-digit code to finish setup.');
      setBusy(false);
    }
    void prepare();
    return () => {
      active = false;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!factorId) return;
    setBusy(true);
    setMessage('Verifying…');
    const form = new FormData(event.currentTarget);
    const code = String(form.get('code') || '').replace(/\s/g, '');
    const supabase = createClient();
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    if (error) {
      setMessage('That code was not accepted. Wait for a new code and try again.');
      setBusy(false);
      return;
    }
    const { data: route } = await supabase.rpc('staff_workspace_route');
    window.location.replace(String(route || '/hq'));
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      {enrollment && (
        <div className="settings-list" aria-label="Authenticator enrollment">
          <Image
            src={enrollment.qrCode}
            alt="QR code for Trade Police HQ authenticator setup"
            width={220}
            height={220}
            unoptimized
          />
          <div className="event-row">
            <span>Manual setup key</span>
            <strong>{enrollment.secret}</strong>
          </div>
        </div>
      )}
      <p>{message}</p>
      <label>
        Authenticator code
        <input
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          minLength={6}
          maxLength={6}
          required
          disabled={busy || !factorId}
        />
      </label>
      <button className="primary" disabled={busy || !factorId}>
        {busy ? 'Preparing…' : 'Verify and enter HQ'}
      </button>
    </form>
  );
}
