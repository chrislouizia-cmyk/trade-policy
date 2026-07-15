import { redirect } from 'next/navigation';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const suffix = params.next ? `?next=${encodeURIComponent(params.next)}` : '';
  redirect(`/client/login${suffix}`);
}
