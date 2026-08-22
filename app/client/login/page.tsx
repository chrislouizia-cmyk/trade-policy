import { redirect } from 'next/navigation';
import ClientLoginForm from '@/components/ClientLoginForm';
import { createClient } from '@/lib/supabase/server';
import { getSafeClientNextPath } from '@/lib/auth/safe-next';

export default async function ClientLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; mode?: string }>;
}) {
  const params = await searchParams;
  const safeNext = getSafeClientNextPath(params.next, '/client/login', '/dashboard');
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (user) {
    const { data: staffRoute } = await supabase.rpc('staff_workspace_route');
    if (staffRoute) redirect(String(staffRoute));
    redirect(safeNext === '/validate' ? '/dashboard' : safeNext);
  }

  if (error) {
    try {
      await supabase.auth.signOut();
    } catch {
      // Ignore stale session cleanup failures; the page will render the canonical login once.
    }
  }

  return (
    <main className="auth-page client-login-page">
      <section className="auth-card portal-auth-card">
        <img src="/brand/trade-police-logo.png" alt="Trade Police" className="brand-logo-wordmark brand-logo-header" width={220} height={46} />
        <span className="eyebrow">TRADE POLICE CLIENT PORTAL</span>
        <h1>Trader sign in</h1>
        <p>Access your strategies, trading accounts, validation tools, analytics and subscription.</p>
        <ClientLoginForm next={safeNext} initialMode={params.mode==='signup'?'signup':'login'} />
      </section>
    </main>
  );
}
