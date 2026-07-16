import { redirect } from 'next/navigation';
import ClientLoginForm from '@/components/ClientLoginForm';
import { createClient } from '@/lib/supabase/server';

export default async function ClientLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next = params.next?.startsWith('/') && !params.next.startsWith('/hq') ? params.next : '/validate';
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    const { data: staffRoute } = await supabase.rpc('staff_workspace_route');
    if (staffRoute) redirect(String(staffRoute));
    redirect(next);
  }

  return (
    <main className="auth-page client-login-page">
      <section className="auth-card portal-auth-card">
        <span className="brand-mark">TP</span>
        <span className="eyebrow">TRADE POLICE CLIENT PORTAL</span>
        <h1>Trader sign in</h1>
        <p>Access your strategies, trading accounts, validation tools, analytics and subscription.</p>
        <ClientLoginForm next={next} />
      </section>
    </main>
  );
}
