import { redirect } from 'next/navigation';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/server';
import HQMfaForm from '@/components/hq/HQMfaForm';

export default async function Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/hq/login');

  const { data: invitation } = await supabase.rpc('current_staff_invitation_onboarding_v1');
  if (invitation) redirect('/hq/onboarding');

  const [{ data: required, error }, { data: assurance }, { data: route }] = await Promise.all([
    supabase.rpc('current_staff_mfa_requirement'),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.rpc('staff_workspace_route'),
  ]);
  if (error || !route) redirect('/hq/login?error=access');
  if (!required || assurance?.currentLevel === 'aal2') redirect(String(route));

  return (
    <main className="auth-page hq-login-page">
      <section className="auth-card portal-auth-card">
        <Image src="/brand/trade-police-mark.png" alt="Trade Police" className="brand-mark" width={42} height={42} />
        <span className="eyebrow">HEADQUARTERS SECURITY</span>
        <h1>Verify your identity</h1>
        <p>HQ contains restricted customer and company information. Use your authenticator app to continue.</p>
        <HQMfaForm />
      </section>
    </main>
  );
}
