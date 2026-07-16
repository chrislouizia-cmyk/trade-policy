import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import HQLoginForm from '@/components/hq/HQLoginForm';

export default async function Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: route } = await supabase.rpc('staff_workspace_route');
    if (route) redirect(String(route));
    await supabase.auth.signOut();
  }

  return (
    <main className="auth-page hq-login-page">
      <section className="auth-card portal-auth-card">
        <span className="brand-mark">TP</span>
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
