import { redirect } from 'next/navigation';
import { getSafeClientNextPath } from '@/lib/auth/safe-next';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next = getSafeClientNextPath(params.next, '/login', '/dashboard');
  redirect(`/client/login?next=${encodeURIComponent(next === '/dashboard' ? '/dashboard' : next)}`);
}
