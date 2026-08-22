import { redirect } from 'next/navigation';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next = params.next && params.next !== '/login' ? params.next : '/dashboard';
  redirect(`/client/login?next=${encodeURIComponent(next)}`);
}
