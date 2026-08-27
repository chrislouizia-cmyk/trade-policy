import PrivateBetaQueue from '@/components/hq/PrivateBetaQueue';
import { getHQContext, HQShell } from '@/lib/hq-page';

export default async function Page() {
  const { role, displayName, permissions } = await getHQContext('beta.manage');

  return (
    <HQShell displayName={displayName} role={role} permissions={permissions}>
      <div className="stack">
        <header>
          <span className="eyebrow">HQ ACCESS CONTROL</span>
          <h1>Private Beta</h1>
          <p className="muted">Review applications, preserve the 1,000-member cap, and control beta entitlements.</p>
        </header>
        <PrivateBetaQueue />
      </div>
    </HQShell>
  );
}
