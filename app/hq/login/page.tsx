import Link from 'next/link';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import HQLoginForm from '@/components/hq/HQLoginForm';

export default async function Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: invitation } = await supabase.rpc('current_staff_invitation_onboarding_v1');
    if (invitation) redirect('/hq/onboarding');
    const { data: route } = await supabase.rpc('staff_workspace_route');
    if (route) {
      const [{ data: mfaRequired }, { data: assurance }] = await Promise.all([
        supabase.rpc('current_staff_mfa_requirement'),
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      ]);
      if (mfaRequired && assurance?.currentLevel !== 'aal2') redirect('/hq/mfa');
      redirect(String(route));
    }
    await supabase.auth.signOut();
  }

  return (
    <main className="auth-page hq-login-page">
      <section className="auth-card portal-auth-card">
        <Image
          src="/brand/trade-police-hq-mark.png"
          alt="Trade Police Headquarters"
          className="hq-login-mark"
          width={147}
          height={147}
          priority
        />
        <span className="eyebrow">TRADE POLICE HEADQUARTERS</span>
        <h1>Employee sign in</h1>
        <p>Headquarters is reserved for Trade Police employees. Your email determines your assigned workspace and permissions.</p>
        <HQLoginForm />
        <small>There is no public employee registration. Access is issued by the Owner.</small>
        <Link className="portal-switch" href="/client/login">Customer? Open client portal</Link>
      </section>
    </main>
  );
}
